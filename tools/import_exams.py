"""Import new ITPEC IT Passport exams into the reviewer, and fill in missing explanations.

1. Reads the ITPEC past-exam page and imports every exam zip (e.g. ip/2026A_IP.zip) that is not in
   data.js yet: the questions are cropped into img/<key>/ and the exam and answer key go into data.js.
2. If GEMINI_API_KEY is set, Google's Gemini API (free tier) writes an explanation for every choice of
   questions that do not have one yet. When the free daily quota runs out, the rest is left for the
   next run, so explanations fill in over a few days without anyone paying for anything.

usage:
  python tools/import_exams.py              import new exams and fill missing explanations
  python tools/import_exams.py --dry-run    only list the new exams
  python tools/import_exams.py --no-explain import only, never call the AI

environment:
  GEMINI_API_KEY   free key from https://aistudio.google.com/apikey (optional)
  GEMINI_MODELS    comma-separated model IDs to try in order (optional, see DEFAULT_MODELS)
  EXPLAIN_LIMIT    most AI requests per run (default 150)
"""
import argparse
import base64
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crop_exam import ExamCropper, LETTERS, crop_exam  # noqa: E402

LIST_URL = 'https://itpec.org/pastexamqa/ip.html'
USER_AGENT = 'Mozilla/5.0 (compatible; philnits-reviewer exam importer)'
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s'
# Free-tier Gemini models, best first. When one runs out of daily quota (or is retired) the next is used.
DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
PACE_SECONDS = 7  # stay under the free tier's requests-per-minute limit

PROMPT = """You write study explanations for a free IT Passport (ITPEC IP) exam reviewer used by students in the Philippines.

The image shows question %d of an ITPEC IT Passport exam. The official answer key says the correct answer is %s).

Write one short explanation for each answer choice a) to d):
- For the correct choice, say why it is right. For a calculation, show the key working in one line.
- For each wrong choice, say why it is wrong, or which term or concept it actually describes.
- Use 1-2 sentences per choice in plain English, with no markdown.
- The app shuffles the choices, so never refer to a choice by its letter (such as "a)" or "option B"); refer to it by its content. Letters that belong to the question itself, such as blanks A-C or statements I-III, are fine.
- Explain the answer that the official key gives. If you believe the key is wrong, still explain the keyed answer and describe the problem in "doubt"; otherwise leave "doubt" empty.

Text extracted from the PDF (it may be garbled; the image is authoritative):
%s"""

SCHEMA = {
    'type': 'OBJECT',
    'properties': {k: {'type': 'STRING'} for k in ('a', 'b', 'c', 'd', 'doubt')},
    'required': ['a', 'b', 'c', 'd', 'doubt'],
}


def fetch(url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=data, headers=dict({'User-Agent': USER_AGENT}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def list_published():
    """{exam key: zip URL} for every IT Passport exam zip linked from the ITPEC page."""
    html = fetch(LIST_URL).decode('utf-8', 'replace')
    found = {}
    for m in re.finditer(r'href="([^"]*?(\d{4}[SA])_IP\.zip)"', html, re.I):
        found[m.group(2).upper()] = urllib.parse.urljoin(LIST_URL, m.group(1))
    return found


def load_data(root):
    text = open(os.path.join(root, 'data.js'), encoding='utf-8').read()
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


def save_data(root, data):
    data['exams'].sort(key=lambda e: (-e['year'], 0 if e['key'].endswith('A') else 1))  # newest first
    with open(os.path.join(root, 'data.js'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('window.QUIZ=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')


def bump_data_version(root):
    """Change the data.js cache-busting query so returning visitors load the new data."""
    path = os.path.join(root, 'index.html')
    html = open(path, encoding='utf-8').read()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M')
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(re.sub(r'(data\.js\?v=)[^"]*', r'\g<1>' + stamp, html))


def exam_meta(title, key):
    """'33rd ITPEC IP Exam, April 2026' -> ('April 2026', '33rd ITPEC IP Exam')."""
    m = re.match(r'(.*?ITPEC\s+IP\s+Exam)\s*,\s*([A-Za-z]+)\s+(\d{4})', title)
    if m:
        return '%s %s' % (m.group(2).capitalize(), m.group(3)), re.sub(r'\s+', ' ', m.group(1)).strip()
    return '%s %s' % ('October' if key.endswith('A') else 'April', key[:4]), 'ITPEC IP Exam'


def download_pdfs(url, key, workdir):
    """Download an exam zip and write its question and answer PDFs into workdir (nothing else is extracted)."""
    archive = zipfile.ZipFile(io.BytesIO(fetch(url)))
    paths = {}
    for info in archive.infolist():
        base = os.path.basename(info.filename)
        for kind in ('Questions', 'Answers'):
            if re.fullmatch(r'%s_IP_%s\.pdf' % (key, kind), base, re.I):
                paths[kind] = os.path.join(workdir, kind + '.pdf')
                with open(paths[kind], 'wb') as fh:
                    fh.write(archive.read(info))
    if len(paths) != 2:
        raise ValueError('%s: zip does not contain both %s_IP_Questions.pdf and %s_IP_Answers.pdf' % (key, key, key))
    return paths['Questions'], paths['Answers']


def needs_explanation(q):
    return not (q.get('x') and all(q['x']))


# ---------- explanations (Gemini API, free tier) ----------
class Explainer:
    """Calls Gemini model by model; a model that is out of quota or no longer exists is skipped."""

    def __init__(self, key, models, limit):
        self.key = key
        self.models = list(models)
        self.left = limit
        self.last_call = 0.0
        self.notes = []

    @property
    def available(self):
        return bool(self.models) and self.left > 0

    def _call(self, model, body):
        wait = PACE_SECONDS - (time.time() - self.last_call)
        if wait > 0:
            time.sleep(wait)
        self.last_call = time.time()
        self.left -= 1
        raw = fetch(GEMINI_URL % (urllib.parse.quote(model), self.key), json.dumps(body).encode('utf-8'),
                    {'Content-Type': 'application/json'}, timeout=300)
        return json.loads(raw)

    def explain(self, png, n, answer, text):
        """Returns (four explanations or None, doubt text)."""
        body = {
            'contents': [{'role': 'user', 'parts': [
                {'inline_data': {'mime_type': 'image/png', 'data': base64.b64encode(png).decode('ascii')}},
                {'text': PROMPT % (n, LETTERS[answer], text)},
            ]}],
            'generationConfig': {'response_mime_type': 'application/json', 'response_schema': SCHEMA},
        }
        retries = 0
        while self.available:
            model = self.models[0]
            try:
                resp = self._call(model, body)
            except urllib.error.HTTPError as e:
                detail = e.read().decode('utf-8', 'replace')[:300]
                if e.code in (400, 401, 403) and 'api key' in detail.lower():
                    self.notes.append('The GEMINI_API_KEY was rejected: %s' % detail.replace('\n', ' '))
                    self.models = []
                    break
                if e.code == 429 and retries < 2 and 'minute' in detail.lower():
                    retries += 1
                    time.sleep(40)
                    continue
                if e.code in (429, 403, 404) or (e.code == 400 and 'not found' in detail.lower()):
                    # out of free quota for today, not allowed on the free tier, or retired: try the next model
                    self.notes.append('%s stopped with HTTP %d: %s' % (model, e.code, detail.replace('\n', ' ')))
                    self.models.pop(0)
                    retries = 0
                    continue
                if e.code >= 500 and retries < 2:
                    retries += 1
                    time.sleep(15)
                    continue
                self.notes.append('Q%d: HTTP %d from %s: %s' % (n, e.code, model, detail.replace('\n', ' ')))
                return None, ''
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                if retries < 2:
                    retries += 1
                    time.sleep(15)
                    continue
                self.notes.append('Q%d: %s' % (n, e))
                return None, ''
            parts = (resp.get('candidates') or [{}])[0].get('content', {}).get('parts', [])
            out_text = ''.join(p.get('text', '') for p in parts if not p.get('thought'))
            try:
                out = json.loads(re.sub(r'^```(?:json)?|```$', '', out_text.strip()))
                xs = [str(out[k]).strip() for k in LETTERS]
            except (ValueError, KeyError, TypeError):
                xs = []
            if len(xs) == 4 and all(xs):
                return xs, str(out.get('doubt', '')).strip()
            if retries < 1:
                retries += 1
                continue
            self.notes.append('Q%d: unusable answer from %s' % (n, model))
            return None, ''
        return None, ''


def fill_explanations(root, data, published, explainer, report):
    """Explain questions without explanations, newest exams first. Returns labels of exams that changed."""
    changed = []
    for exam in data['exams']:
        todo = [q for q in exam['qs'] if needs_explanation(q)]
        if not todo or not explainer.available:
            continue
        if exam['key'] not in published:
            report.append('- %s: questions need explanations, but its zip is not on the ITPEC page' % exam['label'])
            continue
        done = 0
        with tempfile.TemporaryDirectory() as tmp:
            qpdf, _ = download_pdfs(published[exam['key']], exam['key'], tmp)
            with ExamCropper(qpdf, os.path.join(tmp, 'img')) as cropper:
                for q in todo:
                    if not explainer.available:
                        break
                    xs, doubt = explainer.explain(cropper.question_png(q['n']), q['n'], q['a'], cropper.question_text(q['n']))
                    if not xs:
                        continue
                    q['x'] = xs
                    done += 1
                    if doubt:
                        report.append('- %s Q%d: the AI thinks the official answer may be wrong: %s' % (exam['label'], q['n'], doubt))
        left = sum(1 for q in exam['qs'] if needs_explanation(q))
        report.append('- %s: wrote %d explanations, %d questions still waiting' % (exam['label'], done, left))
        if done:
            changed.append('%s (%d explanations)' % (exam['label'], done))
    return changed


def import_exam(root, key, url, report):
    img_dir = os.path.join(root, 'img', key)
    if os.path.isdir(img_dir):
        shutil.rmtree(img_dir)  # leftovers from an earlier failed run; the exam is not in data.js yet
    with tempfile.TemporaryDirectory() as tmp:
        qpdf, apdf = download_pdfs(url, key, tmp)
        title, qs, cropper = crop_exam(qpdf, apdf, img_dir)
        cropper.close()
    label, sub = exam_meta(title, key)
    report.append('### %s (%s) imported' % (label, sub))
    report.extend('- ' + line for line in cropper.log)
    for q in qs:
        q['x'] = ['', '', '', '']
    return {'key': key, 'label': label, 'sub': sub, 'year': int(key[:4]), 'qs': qs}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), help='site folder (default: this repository)')
    ap.add_argument('--min-year', type=int, default=2022, help='ignore exams older than this year (default 2022)')
    ap.add_argument('--dry-run', action='store_true', help='only list the exams that would be imported')
    ap.add_argument('--no-explain', action='store_true', help='never call the AI, even when GEMINI_API_KEY is set')
    args = ap.parse_args()

    data = load_data(args.root)
    have = {e['key'] for e in data['exams']}
    published = list_published()
    new = sorted(k for k in published if k not in have and int(k[:4]) >= args.min_year)
    print('Published:', ', '.join(sorted(published)))
    print('New:', ', '.join(new) or 'none')
    if args.dry_run:
        return

    report, changes, failed = [], [], []
    for key in new:
        try:
            exam = import_exam(args.root, key, published[key], report)
        except Exception as e:  # keep going with the others; the workflow reports the failure
            failed.append(key)
            report.append('### %s could not be imported\n- %s: %s' % (key, type(e).__name__, e))
            shutil.rmtree(os.path.join(args.root, 'img', key), ignore_errors=True)
            continue
        data['exams'].append(exam)
        save_data(args.root, data)
        changes.append(exam['label'])

    waiting = sum(needs_explanation(q) for e in data['exams'] for q in e['qs'])
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if waiting and not args.no_explain:
        if key:
            models = [m.strip() for m in os.environ.get('GEMINI_MODELS', '').split(',') if m.strip()] or DEFAULT_MODELS
            explainer = Explainer(key, models, int(os.environ.get('EXPLAIN_LIMIT') or 150))
            report.append('### Explanations')
            changes += fill_explanations(args.root, data, published, explainer, report)
            report.extend('- ' + note for note in explainer.notes)
            if changes:
                save_data(args.root, data)
        else:
            report.append('### Explanations\n- %d questions have no explanation yet. Add a free GEMINI_API_KEY secret to have them written automatically.' % waiting)

    if changes:
        bump_data_version(args.root)
    message = 'Update exams: ' + '; '.join(changes) if changes else ''
    print('\n'.join(report) or 'Nothing to do.')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as fh:
            fh.write('changed=%s\nmessage=%s\nfailed=%s\n' % ('true' if changes else 'false', message, ' '.join(failed)))
    if os.environ.get('GITHUB_STEP_SUMMARY') and report:
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as fh:
            fh.write('## Exam import\n\n' + '\n'.join(report) + '\n')


if __name__ == '__main__':
    main()
