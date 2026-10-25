"""Turn an ITPEC IT Passport question PDF and answer PDF into the reviewer's question images.

Each question becomes a stem image plus one image per choice (a-d). When the choice labels
cannot be found (for example when they are part of a scanned picture), the whole question is
saved as one image and the reviewer shows plain A-D buttons for it.
"""
import io
import os
import re

import pymupdf
from PIL import Image, ImageDraw

SCALE = 2.25          # rendered pixels per PDF point (1.5x the size the site displays)
DISP = 1.5            # displayed CSS pixels per PDF point
LEFT, RIGHT = 58, 548  # horizontal text area of the question pages, in points
LETTERS = 'abcd'


def parse_answers(answers_pdf):
    """Return (title line, {question number: answer index 0-3}) from the answer key PDF."""
    with pymupdf.open(answers_pdf) as doc:
        return _parse_answer_page(doc[0])


def _parse_answer_page(page):
    words = page.get_text('words')
    nums = [w for w in words if w[4].isdigit() and 1 <= int(w[4]) <= 100]
    lets = [w for w in words if w[4] in ('a', 'b', 'c', 'd')]
    answers = {}
    for n in nums:
        cy = (n[1] + n[3]) / 2
        # the letter in the "Correct Answer" column right of the number, on the same row
        cands = [l for l in lets if l[0] > n[2] and abs((l[1] + l[3]) / 2 - cy) < 4]
        if cands:
            answers.setdefault(int(n[4]), LETTERS.index(min(cands, key=lambda l: l[0] - n[2])[4]))
    title = page.get_text().strip().splitlines()[0].strip()
    return title, answers


def default_topic(n):
    """ITPEC IP papers put technology in Q1-45, management in Q46-65 and strategy in Q66-100."""
    return 't' if n <= 45 else 'm' if n <= 65 else 's'


class ExamCropper:
    def __init__(self, questions_pdf, out_dir):
        self.doc = pymupdf.open(questions_pdf)
        self.out_dir = out_dir
        self.log = []
        self._gfx = {}
        self.pages = [self._analyze(p) for p in self.doc]
        self.marks = self._question_marks()
        self.segments = self._segments()

    def close(self):
        self.doc.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ---------- page analysis ----------
    def _analyze(self, page):
        lines = []
        for b in page.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                t = ''.join(s['text'] for s in l['spans']).strip()
                if t:
                    lines.append((pymupdf.Rect(l['bbox']), t))
        footer = 790.0
        for r, t in lines:
            if r.y0 > 760 and re.fullmatch(r'\W*\d+\W*', t):
                footer = min(footer, r.y0 - 4)
        sections = [(r, t) for r, t in lines if t.startswith('Answer questions')]
        return dict(words=page.get_text('words'), lines=lines, footer=footer, sections=sections)

    def _question_marks(self):
        marks = []
        for pno, pg in enumerate(self.pages):
            for w in pg['words']:
                m = re.fullmatch(r'Q(\d+)\.', w[4])
                if m and w[0] < 75:
                    marks.append((int(m.group(1)), pno, w[1]))
        marks.sort(key=lambda m: (m[1], m[2]))
        nums = [m[0] for m in marks]
        if nums != list(range(1, 101)):
            raise ValueError('expected questions Q1-Q100 in order, found %d markers' % len(nums))
        return marks

    def _page_bottom(self, pno, y_from):
        pg = self.pages[pno]
        b = pg['footer']
        for r, t in pg['sections']:
            if r.y0 > y_from:
                b = min(b, r.y0 - 12)
        return b

    def _page_top(self, pno):
        pg = self.pages[pno]
        tops = [r.y0 for r, t in pg['lines'] if r.y0 < pg['footer']]
        top = min(tops) - 3 if tops else 60
        for r, t in pg['sections']:
            if r.y0 < top + 30:
                top = max(top, r.y1 + 12)
        return top

    def _segments(self):
        """For each question, the (page, y0, y1) ranges it occupies, possibly over several pages."""
        segments = {}
        for i, (n, pno, y) in enumerate(self.marks):
            nxt = self.marks[i + 1] if i + 1 < len(self.marks) else None
            if nxt and nxt[1] == pno:
                segments[n] = [(pno, y - 4, nxt[2] - 6)]
                continue
            segs = [(pno, y - 4, self._page_bottom(pno, y))]
            q = pno + 1
            while q < self.doc.page_count and (nxt is None or q <= nxt[1]):
                if nxt and q == nxt[1]:
                    top = self._page_top(q)
                    if nxt[2] - 6 - top > 12:
                        segs.append((q, top, nxt[2] - 6))
                    break
                if nxt is None:
                    has = [r for r, t in self.pages[q]['lines'] if r.y1 < self.pages[q]['footer'] and len(t) > 3]
                    if not has:
                        break
                segs.append((q, self._page_top(q), self._page_bottom(q, 0)))
                q += 1
            segments[n] = segs
        return segments

    def _words_in(self, seg):
        pno, y0, y1 = seg
        return [w for w in self.pages[pno]['words'] if w[1] >= y0 - 1 and w[3] <= y1 + 1]

    def _lines_in(self, seg):
        pno, y0, y1 = seg
        return [(r, t) for r, t in self.pages[pno]['lines'] if r.y0 >= y0 - 1 and r.y1 <= y1 + 1]

    def _graphics(self, pno):
        if pno not in self._gfx:
            p = self.doc[pno]
            rs = [pymupdf.Rect(d['rect']) for d in p.get_drawings()]
            rs += [pymupdf.Rect(i['bbox']) for i in p.get_image_info()]
            self._gfx[pno] = [r for r in rs if r.width < 600 and r.height < 800]
        return self._gfx[pno]

    # ---------- image helpers ----------
    def _render(self, pno, rect, scale=SCALE):
        pix = self.doc[pno].get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=rect, alpha=False)
        return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')

    @staticmethod
    def _trim(im, pad=5):
        bb = im.convert('L').point(lambda v: 255 if v < 230 else 0).getbbox()
        if not bb:
            return None
        x0, y0, x1, y1 = bb
        return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))

    @staticmethod
    def _cut_big_gap(im, label_y0, label_y1, gap_pt=26):
        """Keep only the block of content next to the choice label when a large blank gap
        separates it from stray content (such as an "Answer questions ..." section box)."""
        g = im.convert('L')
        w, h = g.size
        px = g.load()
        blocks, start, last = [], None, None
        for y in range(h):
            if any(px[x, y] < 230 for x in range(0, w, 2)):
                if start is None:
                    start = y
                elif y - last > gap_pt * SCALE:
                    blocks.append((start, last))
                    start = y
                last = y
        if start is not None:
            blocks.append((start, last))
        if len(blocks) <= 1:
            return im, False
        mid = (label_y0 + label_y1) / 2
        best = min(blocks, key=lambda b: 0 if b[0] - 3 <= mid <= b[1] + 3 else min(abs(mid - b[0]), abs(mid - b[1])))
        return im.crop((0, max(0, best[0] - 6), w, min(h, best[1] + 6))), True

    @staticmethod
    def _stack(images):
        images = [i for i in images if i is not None]
        if len(images) == 1:
            return images[0]
        out = Image.new('RGB', (max(i.width for i in images), sum(i.height for i in images) + 20 * (len(images) - 1)), 'white')
        y = 0
        for i in images:
            out.paste(i, (0, y))
            y += i.height + 20
        return out

    def _save(self, im, name):
        im.convert('L').quantize(8, dither=Image.Dither.NONE).save(os.path.join(self.out_dir, name), 'WEBP', lossless=True, method=6)
        return [name, round(im.width / SCALE * DISP)]

    def question_png(self, n):
        """The whole question as printed (labels included), as PNG bytes - used to write explanations."""
        parts = [self._trim(self._render(p, pymupdf.Rect(LEFT, y0, RIGHT, y1), scale=2.0)) for p, y0, y1 in self.segments[n]]
        buf = io.BytesIO()
        self._stack(parts).save(buf, 'PNG', optimize=True)
        return buf.getvalue()

    def question_text(self, n):
        return '\n'.join(t for seg in self.segments[n] for r, t in self._lines_in(seg))

    # ---------- cropping ----------
    def crop(self, n):
        """Save the images for question n and return its data-file entry (without answer and explanations)."""
        segs = self.segments[n]
        fname = 'Q%03d' % n
        q = {}
        # choice labels in reading order; the PDFs occasionally misprint one (e.g. "e)" for "d)")
        labels = []
        for si, seg in enumerate(segs):
            for w in self._words_in(seg):
                if re.fullmatch(r'[a-e]\)', w[4]):
                    labels.append((si, w))
        labels.sort(key=lambda t: (t[0], round(t[1][1] / 4), t[1][0]))
        group = None
        for k in range(len(labels) - 3, -1, -1):
            cand = labels[k:k + 4]
            if cand[0][1][4] == 'a)' and 'a)' not in [c[1][4] for c in cand[1:]] and len({c[0] for c in cand}) == 1:
                group = cand
                break
        if group and [c[1][4] for c in group] != ['a)', 'b)', 'c)', 'd)']:
            self.log.append('Q%d: misprinted choice labels %s, used printed order' % (n, [c[1][4] for c in group]))
        if not group:
            imgs = [self._trim(self._render(p, pymupdf.Rect(LEFT, y0, RIGHT, y1))) for p, y0, y1 in segs]
            q['f'] = self._save(self._stack(imgs), fname + '_full.webp')
            self.log.append('Q%d: choice labels not found, saved as one image with A-D buttons' % n)
            return q
        segs = segs[:group[0][0] + 1]
        si = group[0][0]
        pno, sy0, sy1 = segs[si]
        lw = [g[1] for g in group]
        pos_of = {id(w): i for i, w in enumerate(lw)}
        rows = []
        for w in lw:
            for row in rows:
                if abs(row[0][1] - w[1]) < 5:
                    row.append(w)
                    break
            else:
                rows.append([w])
        rows.sort(key=lambda r: r[0][1])
        for row in rows:
            row.sort(key=lambda w: w[0])
        # each band (stem, then each row of choices) ends where its own text and drawings end
        boxes = [r for r, t in self._lines_in(segs[si])]
        boxes += [r for r in self._graphics(pno) if r.y0 >= sy0 - 1 and r.y1 <= sy1 + 1]
        row_tops = [min(w[1] for w in row) for row in rows]
        lim = [sy0 - 1] + [t - 9 for t in row_tops] + [sy1 + 1]
        ext = []
        for k in range(len(rows)):
            lo, hi = lim[k], lim[k + 1]
            own = [r.y1 for r in boxes if lo <= r.y0 < hi and r.y1 <= hi + 6]
            ext.append(max(own) + 0.4 if own else hi)
        starts = [min(ext[k], row_tops[k] - 1) for k in range(len(rows))]
        starts[0] = max(starts[0], row_tops[0] - 12)
        bounds = starts[1:] + [sy1]
        stem_parts = [self._trim(self._render(p, pymupdf.Rect(LEFT, y0, RIGHT, y1))) for p, y0, y1 in segs[:si]]
        stem_parts.append(self._trim(self._render(pno, pymupdf.Rect(LEFT, sy0, RIGHT, starts[0]))))
        q['s'] = self._save(self._stack(stem_parts), fname + '_stem.webp')
        opts = [None] * 4
        for ri, row in enumerate(rows):
            y0, y1 = starts[ri], bounds[ri]
            for ci, w in enumerate(row):
                x0 = w[0] - 1
                x1 = row[ci + 1][0] - 3 if ci + 1 < len(row) else RIGHT
                im = self._render(pno, pymupdf.Rect(x0, y0, x1, y1))
                ImageDraw.Draw(im).rectangle([(w[0] - x0 - 0.5) * SCALE, (w[1] - y0 - 0.5) * SCALE,
                                              (w[2] - x0 + 0.5) * SCALE, (w[3] - y0 + 0.5) * SCALE], fill='white')
                im, cut = self._cut_big_gap(im, (w[1] - y0) * SCALE, (w[3] - y0) * SCALE)
                if cut:
                    self.log.append('Q%d: removed stray content below choice %s' % (n, w[4]))
                im = self._trim(im)
                if im is None:
                    self.log.append('Q%d: choice %s looks empty' % (n, w[4]))
                    im = Image.new('RGB', (40, 20), 'white')
                opts[pos_of[id(w)]] = im
        q['o'] = [self._save(im, '%s_%s.webp' % (fname, L)) for L, im in zip(LETTERS, opts)]
        return q


def crop_exam(questions_pdf, answers_pdf, out_dir):
    """Crop all 100 questions into out_dir. Returns (title line, questions list, cropper);
    the caller closes the cropper when done with it."""
    title, answers = parse_answers(answers_pdf)
    if sorted(answers) != list(range(1, 101)):
        raise ValueError('answer key incomplete: %d of 100 answers found' % len(answers))
    os.makedirs(out_dir, exist_ok=True)
    cropper = ExamCropper(questions_pdf, out_dir)
    qs = []
    for n in range(1, 101):
        q = {'n': n, 'a': answers[n], 'c': default_topic(n)}
        q.update(cropper.crop(n))
        qs.append(q)
    return title, qs, cropper
