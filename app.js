(function () {
  'use strict';

  /* ---------- data ---------- */
  const EXAMS = window.QUIZ.exams;
  const LS_KEY = 'ipq_v3';
  const LS_OLD = 'ipq_v2';
  const OLD_ORDER = ['2024A', '2024S', '2023A', '2023S', '2022A', '2022S']; // exam order of the v2 save format
  const NEW_EXAMS = { '2026S': 1, '2025A': 1, '2025S': 1 };
  const LET = ['A', 'B', 'C', 'D'];
  const TOPICS = [
    { id: 't', name: 'Technology', desc: 'Computers, algorithms, networks, databases, security' },
    { id: 'm', name: 'Management', desc: 'Development, project and service management, audit' },
    { id: 's', name: 'Strategy', desc: 'Corporate, legal, business and systems strategy' }
  ];
  const TOPIC = {};
  TOPICS.forEach(t => { TOPIC[t.id] = t; });
  const MOCK_MIX = { t: 45, m: 20, s: 35 }; // topic split of the real 100-question paper
  const DRILL_N = 20;

  const QMAP = {};
  const ORDER = {};
  const ALL = [];
  const EXAM = {};
  const TOPIC_KEYS = { t: [], m: [], s: [] };
  EXAMS.forEach(ex => {
    EXAM[ex.key] = ex;
    ex.keys = ex.qs.map(q => {
      const k = ex.key + '-' + q.n;
      QMAP[k] = { ex, q };
      ORDER[k] = ALL.length;
      ALL.push(k);
      TOPIC_KEYS[q.c].push(k);
      return k;
    });
  });

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const app = $('app');
  const overlay = $('overlay');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const byOrder = (a, b) => ORDER[a] - ORDER[b];
  function clock(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  const PATHS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    chev: '<path d="M9 18l6-6-6-6"/>',
    arrowL: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    redo: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'
  };
  const ic = name => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + PATHS[name] + '</svg>';
  const closeBtn = '<button type="button" class="icon-btn" data-close aria-label="Close">' + ic('x') + '</button>';

  /* ---------- state ---------- */
  function defaults() {
    return {
      v: 3,
      settings: { shuffle: true, autoNext: false, theme: 'system', size: 'M' },
      mix: { exams: EXAMS.map(e => e.key), topics: ['t', 'm', 's'], n: 20 },
      hist: {},   // question key -> { a: last answer (original index), ok, n: attempts, w: wrong count }
      flags: {},  // question key -> 1
      sess: {},   // session id -> session
      last: null  // id of the last session opened
    };
  }

  function record(hist, key, a) {
    const h = hist[key] || { n: 0, w: 0 };
    h.a = a;
    h.ok = a === QMAP[key].q.a;
    h.n++;
    if (!h.ok) h.w++;
    hist[key] = h;
  }

  function examSession(key) {
    const ex = EXAM[key];
    return { id: 'ex-' + key, kind: 'exam', title: ex.label, sub: ex.sub, items: ex.keys.slice(), idx: 0, ans: {}, perm: {}, done: false };
  }

  function migrate(d, old) {
    if (!old || !Array.isArray(old.sess)) return;
    if (old.shuffle === false) d.settings.shuffle = false;
    old.sess.forEach((ss, e) => {
      const key = OLD_ORDER[e];
      if (!key || !EXAM[key] || !ss || !ss.answered) return;
      const s = examSession(key);
      Object.keys(ss.answered).forEach(k => {
        const nk = key + '-' + k.split('-')[1];
        if (!QMAP[nk]) return;
        s.ans[nk] = ss.answered[k];
        if (ss.perm && ss.perm[k]) s.perm[nk] = ss.perm[k];
        record(d.hist, nk, ss.answered[k]);
      });
      if (Object.keys(s.ans).length) {
        s.idx = Math.min(ss.idx || 0, s.items.length - 1);
        d.sess[s.id] = s;
        d.last = d.last || s.id;
      }
    });
    const open = 'ex-' + OLD_ORDER[old.mode];
    if (d.sess[open]) d.last = open;
  }

  function load() {
    const d = defaults();
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { s = null; }
    if (s && s.v === 3) {
      const st = Object.assign(d, s);
      st.settings = Object.assign(defaults().settings, s.settings);
      st.mix = Object.assign(defaults().mix, s.mix);
      Object.keys(st.sess).forEach(id => {
        const ss = st.sess[id];
        if (!ss || !Array.isArray(ss.items)) { delete st.sess[id]; return; }
        ss.items = ss.items.filter(k => QMAP[k]);
        if (!ss.items.length) delete st.sess[id];
        else ss.idx = Math.min(Math.max(0, ss.idx | 0), ss.items.length - 1);
      });
      return st;
    }
    try { migrate(d, JSON.parse(localStorage.getItem(LS_OLD))); } catch (e) { /* no older progress */ }
    return d;
  }

  let state = load();
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked or full */ }
  }

  function getSession(id) {
    if (!id) return null;
    if (state.sess[id]) return state.sess[id];
    if (id.indexOf('ex-') === 0 && EXAM[id.slice(3)]) return (state.sess[id] = examSession(id.slice(3)));
    return null;
  }

  const isLive = s => s.kind === 'mock' && !s.mock.submitted;
  const revealed = (s, key) => (s.kind === 'mock' ? s.mock.submitted : s.ans[key] !== undefined);

  function permOf(s, key) {
    const q = QMAP[key].q;
    if (!q.o) return [0, 1, 2, 3];
    if (!s.perm[key]) s.perm[key] = state.settings.shuffle ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3];
    return s.perm[key];
  }

  function tally(s) {
    let ok = 0, bad = 0, done = 0;
    s.items.forEach(k => {
      const a = s.ans[k];
      if (a === undefined) return;
      done++;
      if (a === QMAP[k].q.a) ok++; else bad++;
    });
    return { ok, bad, done, total: s.items.length };
  }

  function overview() {
    const top = { t: { seen: 0, ok: 0 }, m: { seen: 0, ok: 0 }, s: { seen: 0, ok: 0 } };
    const byExam = {};
    const wrong = [];
    let seen = 0, ok = 0;
    Object.keys(state.hist).forEach(k => {
      const it = QMAP[k];
      if (!it) return;
      const h = state.hist[k];
      seen++;
      if (h.ok) ok++; else wrong.push(k);
      top[it.q.c].seen++;
      if (h.ok) top[it.q.c].ok++;
      const e = byExam[it.ex.key] || (byExam[it.ex.key] = { seen: 0, ok: 0 });
      e.seen++;
      if (h.ok) e.ok++;
    });
    const flags = ALL.filter(k => state.flags[k]);
    return { seen, ok, top, byExam, wrong: wrong.sort(byOrder), flags };
  }

  // Mixes in past mistakes (up to 40%), then questions never seen, then the rest.
  function smartPick(pool, n) {
    const wrong = [], fresh = [], known = [];
    pool.forEach(k => {
      const h = state.hist[k];
      (!h ? fresh : h.ok ? known : wrong).push(k);
    });
    const w = shuffle(wrong);
    const first = w.splice(0, Math.ceil(n * 0.4));
    return shuffle(first.concat(shuffle(fresh), w, shuffle(known)).slice(0, n));
  }

  function startDrill(items, title, sub) {
    if (!items.length) { toast('No questions to practice yet'); return; }
    state.sess.drill = { id: 'drill', kind: 'drill', title, sub, items, idx: 0, ans: {}, perm: {}, done: false };
    save();
    go('#/q/drill');
  }

  function startMock(src, minutes) {
    let items;
    if (src === 'mix') {
      items = [].concat(...TOPICS.map(t => shuffle(TOPIC_KEYS[t.id]).slice(0, MOCK_MIX[t.id])));
    } else {
      items = EXAM[src].keys.slice();
    }
    const now = Date.now();
    state.sess.mock = {
      id: 'mock', kind: 'mock', title: 'Mock exam',
      sub: src === 'mix' ? 'Random mix of all exams' : EXAM[src].label,
      items, idx: 0, ans: {}, perm: {}, done: false,
      mock: { start: now, deadline: minutes ? now + minutes * 60000 : 0, submitted: false }
    };
    save();
    go('#/q/mock');
  }

  function submitMock(s, timedOut) {
    if (s.mock.submitted) return;
    s.mock.submitted = true;
    s.mock.end = Date.now();
    s.done = true;
    s.idx = 0;
    s.items.forEach(k => { if (s.ans[k] !== undefined) record(state.hist, k, s.ans[k]); });
    save();
    stopTimer();
    if (timedOut) toast('Time is up. Your exam was submitted.');
    go('#/r/' + s.id);
  }

  /* ---------- routing ---------- */
  let view = { name: 'home' };
  let mixOpen = false;

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function route() {
    stopTimer();
    closeOverlay();
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const s = parts[0] === 'q' || parts[0] === 'r' ? getSession(parts[1]) : null;
    document.body.classList.toggle('has-bar', !!(s && parts[0] === 'q'));
    if (s && parts[0] === 'q') {
      state.last = s.id;
      renderQuiz(s);
    } else if (s && parts[0] === 'r') {
      renderResults(s);
    } else {
      renderHome();
    }
    window.scrollTo(0, 0);
  }

  /* ---------- home ---------- */
  function section(title, note, inner) {
    return '<section class="section"><div class="section-head"><h2>' + title + '</h2>' + (note ? '<p>' + note + '</p>' : '') + '</div>' + inner + '</section>';
  }

  function tile(act, icon, tone, title, desc, disabled) {
    return `<button type="button" class="tile" data-act="${act}"${disabled ? ' disabled' : ''}>
      <span class="ic ${tone}">${ic(icon)}</span><b>${title}</b><span>${desc}</span></button>`;
  }

  function renderHome() {
    view = { name: 'home' };
    document.title = 'IT Passport Reviewer';
    const ov = overview();
    const total = ALL.length;
    const last = state.last && state.sess[state.last];
    const resume = last && !last.done && (last.idx > 0 || tally(last).done > 0) ? last : null;

    let h = `<section class="card hero">
      <div>
        <h1>${ov.seen ? 'Welcome back' : 'Get ready for the IT Passport exam'}</h1>
        <p>${total} past questions from ${EXAMS.length} ITPEC exams, each with an explanation for every choice.</p>
        <div class="hero-actions">
          ${resume ? `<button type="button" class="btn primary" data-act="resume">${ic('play')}Continue ${esc(resume.title)} · Q${resume.idx + 1}</button>` : ''}
          <button type="button" class="btn${resume ? '' : ' primary'}" data-act="smart">${ic('bolt')}Smart practice</button>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><b>${ov.seen}<small> / ${total}</small></b><span>questions answered</span><div class="meter"><i style="width:${pct(ov.seen, total)}%"></i></div></div>
        <div class="stat"><b>${ov.seen ? pct(ov.ok, ov.seen) + '%' : '–'}</b><span>correct on latest try</span></div>
        <div class="stat"><b>${ov.wrong.length}</b><span>mistakes to review</span></div>
        <div class="stat"><b>${ov.flags.length}</b><span>flagged</span></div>
      </div>
    </section>`;

    h += section('Quick study', 'Short sets that focus on what you still miss', `<div class="tiles">
      ${tile('smart', 'bolt', '', 'Smart practice', DRILL_N + ' questions: new ones plus your past mistakes')}
      ${tile('mistakes', 'redo', 'bad', 'Review mistakes', ov.wrong.length ? plural(ov.wrong.length, 'question') + ' you got wrong' : 'Nothing to review yet', !ov.wrong.length)}
      ${tile('flagged', 'flag', 'flag', 'Flagged', ov.flags.length ? plural(ov.flags.length, 'question') + ' saved for later' : 'Flag questions to come back to them', !ov.flags.length)}
      ${tile('mock', 'clock', 'ok', 'Mock exam', '100 questions, 120 minutes, with a pass estimate')}
    </div>`);

    h += section('Practice by topic', 'Each set picks ' + DRILL_N + ' questions, favoring ones you missed or have not seen', `<div class="topics">${TOPICS.map(t => {
      const st = ov.top[t.id], n = TOPIC_KEYS[t.id].length;
      return `<button type="button" class="card topic ${t.id}" data-act="topic" data-topic="${t.id}">
        <div class="row-top"><b>${t.name}</b><span class="pill ${t.id}">${n} Qs</span></div>
        <span class="desc">${t.desc}</span>
        <div class="meter"><i style="width:${pct(st.seen, n)}%"></i></div>
        <div class="row-foot"><span>${st.seen ? pct(st.ok, st.seen) + '% correct · ' + st.seen + ' done' : 'Not started'}</span><span class="go">Practice${ic('arrowR')}</span></div>
      </button>`;
    }).join('')}</div>`);

    h += section('Past exams', 'Go through a full paper in order', `<div class="exams">${EXAMS.map(ex => {
      const e = ov.byExam[ex.key] || { seen: 0, ok: 0 };
      const s = state.sess['ex-' + ex.key];
      const t = s ? tally(s) : null;
      const cta = s && s.done ? 'Results' : t && t.done ? 'Continue' : 'Start';
      return `<button type="button" class="card exam" data-act="exam" data-key="${ex.key}">
        <div class="row-top"><div><b>${esc(ex.label)}</b><small>${NEW_EXAMS[ex.key] ? '<span class="badge-new">NEW</span> ' : ''}${esc(ex.sub)}</small></div></div>
        <div class="meter"><i style="width:${pct(e.seen, ex.qs.length)}%"></i></div>
        <div class="row-foot"><span>${e.seen ? e.seen + '/' + ex.qs.length + ' · ' + pct(e.ok, e.seen) + '%' : 'Not started'}</span><span class="go">${cta}${ic('arrowR')}</span></div>
      </button>`;
    }).join('')}</div>`);

    h += `<section class="section"><details class="card panel" id="mixPanel"${mixOpen ? ' open' : ''}>
      <summary><span class="ic">${ic('shuffle')}</span><span><b>Custom set</b><small>Choose exams, topics and how many questions</small></span>${ic('chev')}</summary>
      <div class="panel-body" id="mixBody"></div>
    </details></section>`;

    h += `<footer class="foot">
      <p>Progress is saved in this browser only.</p>
      <p class="kbd-only">While answering: <kbd>A</kbd>–<kbd>D</kbd> or <kbd>1</kbd>–<kbd>4</kbd> to answer · <kbd>Enter</kbd> next · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>F</kbd> flag · <kbd>G</kbd> question list</p>
    </footer>`;

    app.innerHTML = h;
    $('mixPanel').addEventListener('toggle', e => { mixOpen = e.target.open; });
    renderMix();
  }

  function mixPool() {
    const m = state.mix;
    return ALL.filter(k => m.exams.indexOf(QMAP[k].ex.key) >= 0 && m.topics.indexOf(QMAP[k].q.c) >= 0);
  }

  function renderMix() {
    const body = $('mixBody');
    if (!body) return;
    const m = state.mix;
    const years = [...new Set(EXAMS.map(e => e.year))];
    const pool = mixPool();
    const n = m.n && m.n < pool.length ? m.n : pool.length;
    body.innerHTML = `
      <div class="field"><span class="field-label">Exams</span>
        ${years.map(y => `<div class="year-row"><span class="year">${y}</span><div class="chips">${EXAMS.filter(e => e.year === y).map(e =>
          `<button type="button" class="chip${m.exams.indexOf(e.key) >= 0 ? ' on' : ''}" data-act="mix-ex" data-key="${e.key}" aria-pressed="${m.exams.indexOf(e.key) >= 0}">${esc(e.label.split(' ')[0])}</button>`).join('')}</div></div>`).join('')}
        <div class="mix-links"><button type="button" class="link" data-act="mix-all" data-on="1">Select all</button><button type="button" class="link" data-act="mix-all" data-on="0">Clear</button></div>
      </div>
      <div class="field"><span class="field-label">Topics</span><div class="chips">${TOPICS.map(t =>
        `<button type="button" class="chip${m.topics.indexOf(t.id) >= 0 ? ' on' : ''}" data-act="mix-top" data-topic="${t.id}" aria-pressed="${m.topics.indexOf(t.id) >= 0}">${t.name}</button>`).join('')}</div></div>
      <div class="field"><span class="field-label">Questions</span><div class="seg">${[10, 20, 50, 100, 0].map(v =>
        `<button type="button" class="${m.n === v ? 'on' : ''}" data-act="mix-n" data-n="${v}">${v || 'All'}</button>`).join('')}</div></div>
      <div class="mix-foot"><span>${plural(pool.length, 'question')} match</span>
        <button type="button" class="btn primary" data-act="mix-start"${pool.length ? '' : ' disabled'}>Start ${plural(n, 'question')}</button></div>`;
  }

  function onHomeAct(act, el) {
    const m = state.mix;
    switch (act) {
      case 'resume': go('#/q/' + state.last); break;
      case 'smart': startDrill(smartPick(ALL, DRILL_N), 'Smart practice', 'Mixed set'); break;
      case 'mistakes': { const w = overview().wrong; startDrill(shuffle(w), 'Mistakes review', plural(w.length, 'question')); break; }
      case 'flagged': { const f = overview().flags; startDrill(f, 'Flagged questions', plural(f.length, 'question')); break; }
      case 'mock': openMockSetup(); break;
      case 'topic': { const t = el.dataset.topic; startDrill(smartPick(TOPIC_KEYS[t], DRILL_N), TOPIC[t].name, 'Topic practice'); break; }
      case 'exam': { const s = state.sess['ex-' + el.dataset.key]; go((s && s.done ? '#/r/' : '#/q/') + 'ex-' + el.dataset.key); break; }
      case 'mix-ex': {
        const i = m.exams.indexOf(el.dataset.key);
        if (i >= 0) m.exams.splice(i, 1); else m.exams.push(el.dataset.key);
        save(); renderMix(); break;
      }
      case 'mix-all': m.exams = el.dataset.on === '1' ? EXAMS.map(e => e.key) : []; save(); renderMix(); break;
      case 'mix-top': {
        const i = m.topics.indexOf(el.dataset.topic);
        if (i >= 0) m.topics.splice(i, 1); else m.topics.push(el.dataset.topic);
        save(); renderMix(); break;
      }
      case 'mix-n': m.n = +el.dataset.n; save(); renderMix(); break;
      case 'mix-start': {
        const pool = shuffle(mixPool());
        startDrill(m.n ? pool.slice(0, m.n) : pool, 'Custom set', 'Custom mix');
        break;
      }
      default: return false;
    }
    return true;
  }

  /* ---------- quiz ---------- */
  const cur = () => (view.name === 'quiz' ? getSession(view.id) : null);

  function img(base, pair, alt) {
    return `<img class="qi" src="${base}${pair[0]}" style="--w:${pair[1]}" alt="${alt}" decoding="async">`;
  }

  function kindLabel(s) {
    if (s.kind === 'exam') return 'Full exam';
    if (s.kind === 'mock') return s.mock.submitted ? 'Reviewing answers' : s.sub;
    return s.sub || 'Practice set';
  }

  function renderQuiz(s) {
    if (isLive(s) && s.mock.deadline && Date.now() >= s.mock.deadline) { submitMock(s, true); return; }
    view = { name: 'quiz', id: s.id };
    const key = s.items[s.idx];
    const { ex, q } = QMAP[key];
    const perm = permOf(s, key);
    const base = 'img/' + ex.key + '/';
    const h = state.hist[key];
    const missedBefore = h && !h.ok && !revealed(s, key) && !isLive(s);
    document.title = 'Q' + (s.idx + 1) + ' · ' + s.title + ' · IT Passport Reviewer';

    const stem = `<figure class="stem" data-act="zoom" title="Tap to enlarge">${img(base, q.o ? q.s : q.f, 'Question ' + q.n)}</figure>
      <div class="verdict" id="verdict" aria-live="polite"></div>`;
    const choices = q.o
      ? `<div class="choices" id="choices">${perm.map((o, pos) => `<div class="choice-row"><button type="button" class="choice" data-act="choose" data-pos="${pos}">
          <span class="key">${LET[pos]}</span><span class="cimg">${img(base, q.o[o], 'Choice ' + LET[pos])}</span></button></div>`).join('')}</div>`
      : `<div class="choices letters" id="choices">${LET.map((L, pos) => `<button type="button" class="choice" data-act="choose" data-pos="${pos}"><span class="key">${L}</span></button>`).join('')}</div><div id="whyList"></div>`;

    app.innerHTML = `
      <div class="qhead">
        <button type="button" class="icon-btn" data-act="home" aria-label="Back to home">${ic('back')}</button>
        <div class="titles"><b>${esc(s.title)}</b><span id="qsub"></span></div>
        <div class="qright" id="qright"></div>
      </div>
      <div class="pbar" id="pbar"></div>
      <article class="card qcard" id="qcard">
        <div class="qmeta">
          <span class="pill ${q.c}">${TOPIC[q.c].name}</span>
          <span class="qsrc">${s.kind === 'exam' ? 'Question ' + q.n : esc(ex.label) + ' · Q' + q.n}</span>
          ${missedBefore ? '<span class="hint-badge">Missed last time</span>' : ''}
          <button type="button" class="flag-btn" id="flagBtn" data-act="flag"></button>
        </div>
        ${stem}
        ${choices}
      </article>
      <p class="kbd-hint kbd-only"><kbd>A</kbd>–<kbd>D</kbd> answer · <kbd>Enter</kbd> next · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>F</kbd> flag · <kbd>G</kbd> question list</p>
      <nav class="actionbar" aria-label="Question navigation"><div class="in">
        <button type="button" class="btn" id="prevBtn" data-act="prev">${ic('arrowL')}<span class="lbl">Prev</span></button>
        <button type="button" class="btn ghost navbtn" data-act="nav" aria-label="Open question list">${ic('grid')}<span id="navLbl"></span></button>
        <button type="button" class="btn" id="nextBtn" data-act="next"></button>
      </div></nav>`;

    paint(s);
    fitImages();
    preload(s);
    if (isLive(s) && s.mock.deadline) startTimer(s);
    save();
  }

  function why(q, o, ans, letter) {
    const ok = o === q.a;
    return `<div class="why ${ok ? 'ok' : 'no'}${!ok && o !== ans ? ' other' : ''}"><span class="tag">${letter ? letter + ' · ' : ''}${ok ? 'Correct' : 'Incorrect'}</span>${o === ans ? '<span class="mine">Your answer</span>' : ''}${esc(q.x[o] || '')}</div>`;
  }

  // Updates everything that depends on the answer state without reloading the images.
  function paint(s) {
    const key = s.items[s.idx];
    const { q } = QMAP[key];
    const ans = s.ans[key];
    const rev = revealed(s, key);
    const live = isLive(s);
    const perm = permOf(s, key);
    const box = $('choices');
    box.classList.toggle('revealed', rev);
    box.querySelectorAll('.choice').forEach(btn => {
      const pos = +btn.dataset.pos, o = perm[pos];
      const isAns = o === q.a, mine = o === ans;
      btn.className = 'choice' + (rev ? (isAns ? ' correct' : mine ? ' wrong' : ' dim') : mine ? ' picked' : '');
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      btn.setAttribute('aria-label', 'Choice ' + LET[pos] + (rev && isAns ? ', correct answer' : '') + (mine ? ', your answer' : ''));
      btn.querySelector('.key').innerHTML = rev && isAns ? ic('check') : rev && mine ? ic('x') : LET[pos];
      if (q.o) {
        const row = btn.parentNode, w = row.querySelector('.why');
        if (rev && !w) row.insertAdjacentHTML('beforeend', why(q, o, ans));
        if (!rev && w) w.remove();
      }
    });
    if (!q.o) $('whyList').innerHTML = rev ? LET.map((L, i) => why(q, i, ans, L)).join('') : '';

    const v = $('verdict'), right = LET[perm.indexOf(q.a)];
    if (!rev) {
      v.className = 'verdict idle';
      v.textContent = live ? (ans === undefined ? 'Choose an answer. You can change it until you submit.' : 'Answer saved. Choose it again to clear it.') : 'Choose an answer';
    } else if (ans === undefined) {
      v.className = 'verdict bad';
      v.textContent = 'Not answered. The answer is ' + right + '.';
    } else if (ans === q.a) {
      v.className = 'verdict ok';
      v.innerHTML = ic('check') + 'Correct!';
    } else {
      v.className = 'verdict bad';
      v.innerHTML = ic('x') + 'Not quite. The answer is ' + right + '.';
    }

    const fl = !!state.flags[key], fb = $('flagBtn');
    fb.className = 'flag-btn' + (fl ? ' on' : '');
    fb.setAttribute('aria-pressed', fl ? 'true' : 'false');
    fb.innerHTML = ic('flag') + (fl ? 'Flagged' : 'Flag');

    const t = tally(s), n = s.items.length;
    $('qsub').textContent = kindLabel(s) + ' · ' + (s.idx + 1) + ' of ' + n;
    $('qright').innerHTML = live
      ? (s.mock.deadline ? `<span class="timer" id="timer">${clock(s.mock.deadline - Date.now())}</span>` : '') + '<button type="button" class="btn sm primary" data-act="submit">Submit</button>'
      : `<span class="score" aria-label="${t.ok} correct, ${t.bad} wrong"><span class="ok">${ic('check')}${t.ok}</span><span class="bad">${ic('x')}${t.bad}</span></span>`;
    $('pbar').innerHTML = live
      ? `<i class="done" style="width:${t.done / n * 100}%"></i>`
      : `<i class="ok" style="width:${t.ok / n * 100}%"></i><i class="bad" style="width:${t.bad / n * 100}%"></i>`;

    $('navLbl').textContent = (s.idx + 1) + ' / ' + n;
    $('prevBtn').disabled = s.idx === 0;
    const last = s.idx === n - 1, nb = $('nextBtn');
    nb.className = 'btn' + (rev || (live && ans !== undefined) ? ' primary' : '');
    nb.innerHTML = '<span>' + (last ? (live ? 'Submit' : 'Finish') : 'Next') + '</span>' + ic(last ? 'check' : 'arrowR');
  }

  // Scales the stem and the choices separately so each fits the card; short choices stay full size on phones.
  function fitImages() {
    const s = cur(), card = $('qcard');
    if (!s || !card) return;
    const { q } = QMAP[s.items[s.idx]];
    const size = state.settings.size;
    const scale = r => (size === 'L' ? Math.min(Math.max(r * 1.3, 0.55), 1.3)
      : size === 'S' ? Math.min(Math.max(r, 0.34), 0.82)
      : Math.min(Math.max(r, 0.36), 1)).toFixed(3);
    const stem = card.querySelector('.stem');
    stem.style.setProperty('--k', scale(stem.clientWidth / (q.o ? q.s[1] : q.f[1])));
    const c = card.querySelector('.cimg');
    if (q.o && c) $('choices').style.setProperty('--k', scale(c.clientWidth / Math.max(...q.o.map(o => o[1]))));
  }

  const preloaded = {};
  function preload(s) {
    const k = s.items[s.idx + 1];
    if (!k || preloaded[k]) return;
    preloaded[k] = 1;
    const { ex, q } = QMAP[k];
    (q.o ? [q.s].concat(q.o) : [q.f]).forEach(p => { new Image().src = 'img/' + ex.key + '/' + p[0]; });
  }

  function choose(pos) {
    const s = cur();
    if (!s) return;
    const key = s.items[s.idx], q = QMAP[key].q;
    const o = permOf(s, key)[pos];
    if (s.kind === 'mock') {
      if (s.mock.submitted) return;
      if (s.ans[key] === o) delete s.ans[key]; else s.ans[key] = o;
      save(); paint(s);
      return;
    }
    if (s.ans[key] !== undefined) return;
    s.ans[key] = o;
    record(state.hist, key, o);
    save(); paint(s);
    if (o === q.a && state.settings.autoNext) {
      const at = s.idx;
      setTimeout(() => { if (cur() === s && s.idx === at) next(); }, 750);
    }
  }

  function move(d) {
    const s = cur();
    if (!s) return;
    const i = s.idx + d;
    if (i < 0 || i >= s.items.length) return;
    s.idx = i;
    save();
    renderQuiz(s);
    window.scrollTo(0, 0);
  }

  function next() {
    const s = cur();
    if (!s) return;
    if (s.idx < s.items.length - 1) { move(1); return; }
    if (isLive(s)) { confirmSubmit(s); return; }
    s.done = true;
    save();
    go('#/r/' + s.id);
  }

  function toggleFlag() {
    const s = cur();
    if (!s) return;
    const k = s.items[s.idx];
    if (state.flags[k]) delete state.flags[k]; else state.flags[k] = 1;
    save(); paint(s);
    toast(state.flags[k] ? 'Flagged for later' : 'Flag removed');
  }

  function onQuizAct(act, el) {
    switch (act) {
      case 'choose': choose(+el.dataset.pos); break;
      case 'prev': move(-1); break;
      case 'next': next(); break;
      case 'flag': toggleFlag(); break;
      case 'nav': openNavigator(); break;
      case 'submit': confirmSubmit(cur()); break;
      case 'zoom': openZoom(); break;
      default: return false;
    }
    return true;
  }

  /* ---------- mock timer ---------- */
  let timerId = null;
  function startTimer(s) {
    stopTimer();
    timerId = setInterval(() => {
      const left = s.mock.deadline - Date.now();
      if (left <= 0) { stopTimer(); submitMock(s, true); return; }
      const el = $('timer');
      if (el) { el.textContent = clock(left); el.classList.toggle('low', left < 5 * 60000); }
    }, 1000);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  /* ---------- results ---------- */
  function resultOf(s) {
    const r = { total: s.items.length, ok: 0, bad: 0, skip: 0, missed: [], top: {} };
    s.items.forEach((k, i) => {
      const q = QMAP[k].q, a = s.ans[k];
      const t = r.top[q.c] || (r.top[q.c] = { total: 0, done: 0, ok: 0 });
      t.total++;
      if (a === undefined) {
        r.skip++;
        if (s.kind === 'mock') r.missed.push(i);
        return;
      }
      t.done++;
      if (a === q.a) { r.ok++; t.ok++; } else { r.bad++; r.missed.push(i); }
    });
    return r;
  }

  function renderResults(s) {
    if (isLive(s)) { go('#/q/' + s.id); return; }
    view = { name: 'results', id: s.id };
    document.title = 'Results · ' + s.title + ' · IT Passport Reviewer';
    const r = resultOf(s), mock = s.kind === 'mock';
    const answered = r.ok + r.bad;
    const main = mock ? pct(r.ok, r.total) : pct(r.ok, answered);
    const tone = main >= 60 ? 'ok' : main >= 40 ? 'warn' : 'bad';
    const headline = !mock && !answered ? 'No answers yet'
      : main >= 80 ? 'Excellent work' : main >= 60 ? 'Good job' : main >= 40 ? 'Getting there' : 'Keep practicing';

    let pass = '';
    if (mock) {
      const each = TOPICS.every(t => !r.top[t.id] || r.top[t.id].ok / r.top[t.id].total >= 0.3);
      const passed = r.ok / r.total >= 0.6 && each;
      pass = `<div class="passbox ${passed ? 'pass' : 'fail'}">${passed ? 'Likely pass' : 'Below the passing line'}<small>A pass needs at least 60% overall and 30% in each topic.</small></div>`;
    }
    const mins = mock ? Math.max(1, Math.round((s.mock.end - s.mock.start) / 60000)) : 0;
    const detail = mock
      ? `${r.ok} of ${r.total} correct · ${plural(r.skip, 'unanswered question')} · ${plural(mins, 'minute')}`
      : `${r.ok} of ${plural(answered, 'answered question')} correct${r.skip ? ' · ' + r.skip + ' skipped' : ''}`;
    const again = s.kind === 'exam' ? `<button type="button" class="btn" data-act="restart">${ic('redo')}Restart exam</button>`
      : mock ? `<button type="button" class="btn" data-act="mock">${ic('clock')}New mock exam</button>`
      : `<button type="button" class="btn" data-act="smart">${ic('bolt')}New smart set</button>`;

    const bars = TOPICS.filter(t => r.top[t.id]).map(t => {
      const x = r.top[t.id], base = mock ? x.total : x.done, p = pct(x.ok, base);
      return `<div class="tb ${t.id}"><div class="tbar-head"><b>${t.name}</b><span>${x.ok} / ${base} · ${p}%</span></div>
        <div class="tbar"><i style="width:${p}%"></i>${mock ? '<span class="mark" title="30% minimum"></span>' : ''}</div></div>`;
    }).join('');

    const rows = r.missed.map(i => {
      const k = s.items[i], { ex, q } = QMAP[k], a = s.ans[k];
      const perm = q.o ? s.perm[k] || [0, 1, 2, 3] : [0, 1, 2, 3];
      return `<button type="button" class="card miss" data-act="jump" data-i="${i}">
        <span class="pill ${q.c}">${TOPIC[q.c].name}</span>
        <span class="what"><b>Question ${i + 1}</b><small>${esc(ex.label)} · Q${q.n}</small></span>
        <span class="ans">${a === undefined ? 'Unanswered' : 'You: ' + LET[perm.indexOf(a)]} · Answer: ${LET[perm.indexOf(q.a)]}</span>${ic('chev')}
      </button>`;
    }).join('');

    app.innerHTML = `
      <div class="qhead">
        <button type="button" class="icon-btn" data-act="home" aria-label="Back to home">${ic('back')}</button>
        <div class="titles"><b>${esc(s.title)}</b><span>${mock ? 'Mock exam results · ' + esc(s.sub) : 'Results'}</span></div>
      </div>
      <section class="card result-hero">
        <div class="ring ${tone}" style="--p:${main}"><b>${main}%</b></div>
        <h1>${headline}</h1>
        <p class="muted">${detail}</p>
        ${pass}
        <div class="res-actions">
          ${r.missed.length ? `<button type="button" class="btn primary" data-act="retry">${ic('redo')}Retry ${plural(r.missed.length, 'missed question')}</button>` : ''}
          <button type="button" class="btn${r.missed.length ? '' : ' primary'}" data-act="review">Review answers</button>
          ${again}
        </div>
      </section>
      ${bars ? section('By topic', mock ? 'The line marks the 30% minimum' : '', '<div class="card tbars">' + bars + '</div>') : ''}
      ${rows ? section(mock ? 'Missed or unanswered' : 'Missed questions', 'Open one to read the explanations', '<div class="misses">' + rows + '</div>') : ''}`;
  }

  function onResultsAct(act, el) {
    const s = getSession(view.id);
    if (!s) return false;
    switch (act) {
      case 'retry': {
        const items = resultOf(s).missed.map(i => s.items[i]);
        startDrill(shuffle(items), 'Retry missed', 'From ' + s.title);
        break;
      }
      case 'review': s.idx = 0; save(); go('#/q/' + s.id); break;
      case 'jump': s.idx = +el.dataset.i; save(); go('#/q/' + s.id); break;
      case 'restart': state.sess[s.id] = examSession(s.id.slice(3)); save(); go('#/q/' + s.id); break;
      default: return false;
    }
    return true;
  }

  /* ---------- overlays ---------- */
  function openModal(html, cls) {
    overlay.innerHTML = `<div class="backdrop" data-close></div><div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
    overlay.classList.add('open');
    document.body.classList.add('noscroll');
    const first = overlay.querySelector('.modal [data-autofocus]') || overlay.querySelector('.modal button');
    if (first) first.focus({ preventScroll: true });
  }
  function closeOverlay() {
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    overlay.innerHTML = '';
    document.body.classList.remove('noscroll');
  }
  const overlayOpen = () => overlay.classList.contains('open');

  function openNavigator() {
    const s = cur();
    if (!s) return;
    const live = isLive(s);
    const cells = s.items.map((k, i) => {
      const a = s.ans[k], q = QMAP[k].q;
      let c = 'cell';
      if (a !== undefined) c += revealed(s, k) ? (a === q.a ? ' ok' : ' bad') : ' done';
      else if (s.kind === 'mock' && !live) c += ' skip';
      if (i === s.idx) c += ' cur';
      if (state.flags[k]) c += ' flag';
      return `<button type="button" class="${c}" data-act="goto" data-i="${i}">${i + 1}</button>`;
    }).join('');
    const legend = live
      ? '<span><i class="done"></i>Answered</span><span><i></i>Not answered</span><span><i class="flag"></i>Flagged</span>'
      : '<span><i class="ok"></i>Correct</span><span><i class="bad"></i>Wrong</span><span><i></i>Not answered</span><span><i class="flag"></i>Flagged</span>';
    openModal(`<div class="modal-head"><h2>${esc(s.title)} · ${s.items.length} questions</h2>${closeBtn}</div>
      <div class="legend">${legend}</div><div class="cells">${cells}</div>`);
    const curCell = overlay.querySelector('.cell.cur');
    if (curCell) curCell.focus({ preventScroll: true });
  }

  function openZoom() {
    const s = cur();
    if (!s) return;
    const { ex, q } = QMAP[s.items[s.idx]];
    const k = window.innerWidth < 640 ? 1 : 1.35;
    openModal(`<div class="modal-head"><h2>Question ${q.n}</h2>${closeBtn}</div>
      <div class="zoom" style="--k:${k}">${img('img/' + ex.key + '/', q.o ? q.s : q.f, 'Question ' + q.n + ', enlarged')}</div>`, 'wide');
  }

  function confirmSubmit(s) {
    if (!s || !isLive(s)) return;
    const left = s.items.length - tally(s).done;
    openModal(`<div class="modal-head"><h2>Submit your mock exam?</h2>${closeBtn}</div>
      <p class="muted">${left ? `You still have ${plural(left, 'unanswered question')}. They count as wrong.` : 'Every question has an answer.'} After you submit you will see your score and all the explanations.</p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Keep working</button><button type="button" class="btn primary" data-act="do-submit" data-autofocus>Submit exam</button></div>`);
  }

  let mockOpt = { src: 'mix', mins: 120 };
  function openMockSetup() {
    const m = state.sess.mock;
    const live = m && isLive(m);
    const left = live && m.mock.deadline ? ' · ' + clock(m.mock.deadline - Date.now()) + ' left' : '';
    openModal(`<div class="modal-head"><h2>Mock exam</h2>${closeBtn}</div>
      <p class="muted">Answers stay hidden until you submit, just like the real test. The IT Passport exam has 100 questions in 120 minutes. You pass with 60% overall and at least 30% in each topic.</p>
      ${live ? `<div class="notice"><span>Mock in progress: ${tally(m).done} / ${m.items.length} answered${left}</span><button type="button" class="btn sm primary" data-act="mock-resume">Resume</button></div>` : ''}
      <div class="field"><label for="mockSrc">Questions</label><select id="mockSrc">
        <option value="mix"${mockOpt.src === 'mix' ? ' selected' : ''}>Random mix of all exams</option>
        ${EXAMS.map(e => `<option value="${e.key}"${mockOpt.src === e.key ? ' selected' : ''}>${esc(e.label)} · ${esc(e.sub)}</option>`).join('')}
      </select></div>
      <div class="field"><span class="field-label">Time limit</span><div class="seg" id="mockTime">${[[120, '120 min'], [60, '60 min'], [0, 'No limit']].map(([v, l]) =>
        `<button type="button" class="${mockOpt.mins === v ? 'on' : ''}" data-act="mock-time" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn${live ? '' : ' primary'}" data-act="mock-start">${live ? 'Start a new one' : 'Start mock exam'}</button></div>`);
    $('mockSrc').addEventListener('change', e => { mockOpt.src = e.target.value; });
  }

  function openSettings() {
    const st = state.settings;
    const seg = (act, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
    openModal(`<div class="modal-head"><h2>Settings</h2>${closeBtn}</div>
      <div class="set-row"><div><b>Shuffle answer choices</b><span>Letters are reassigned, so you learn the answer instead of its position.</span></div>
        <button type="button" class="toggle" role="switch" aria-checked="${st.shuffle}" aria-label="Shuffle answer choices" data-act="set-toggle" data-k="shuffle"></button></div>
      <div class="set-row"><div><b>Go to next after a correct answer</b><span>Saves a tap when you already know it. Wrong answers always wait.</span></div>
        <button type="button" class="toggle" role="switch" aria-checked="${st.autoNext}" aria-label="Go to next after a correct answer" data-act="set-toggle" data-k="autoNext"></button></div>
      <div class="set-row stack"><div><b>Question size</b><span>Large may need sideways scrolling on phones.</span></div>
        ${seg('set-size', st.size, [['S', 'Small'], ['M', 'Fit'], ['L', 'Large']])}</div>
      <div class="set-row stack"><div><b>Theme</b><span>System follows your device setting.</span></div>
        ${seg('set-theme', st.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="set-row"><div><b>Reset all progress</b><span>Clears answers, mistakes, flags and sessions saved in this browser.</span></div>
        <button type="button" class="btn sm danger" data-act="reset">Reset</button></div>`);
  }

  function onOverlayAct(act, el) {
    switch (act) {
      case 'goto': { const s = cur(); if (!s) break; s.idx = +el.dataset.i; save(); closeOverlay(); renderQuiz(s); window.scrollTo(0, 0); break; }
      case 'do-submit': { const s = cur(); closeOverlay(); if (s) submitMock(s); break; }
      case 'mock-time': mockOpt.mins = +el.dataset.v; el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); break;
      case 'mock-start': closeOverlay(); startMock(mockOpt.src, mockOpt.mins); break;
      case 'mock-resume': closeOverlay(); go('#/q/mock'); break;
      case 'set-toggle': {
        const k = el.dataset.k;
        state.settings[k] = !state.settings[k];
        el.setAttribute('aria-checked', state.settings[k]);
        if (k === 'shuffle') {
          // Re-deal choices only for questions that have not been answered yet.
          Object.keys(state.sess).forEach(id => {
            const s = state.sess[id];
            Object.keys(s.perm).forEach(q => { if (s.ans[q] === undefined && !(s.kind === 'mock' && s.mock.submitted)) delete s.perm[q]; });
          });
          const s = cur();
          if (s && !revealed(s, s.items[s.idx]) && s.ans[s.items[s.idx]] === undefined) renderQuiz(s);
        }
        save();
        break;
      }
      case 'set-size':
        state.settings.size = el.dataset.v; save(); fitImages();
        el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
        break;
      case 'set-theme':
        state.settings.theme = el.dataset.v; save(); applyTheme();
        el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
        break;
      case 'reset':
        if (confirm('Clear all answers, mistakes, flags and sessions? This cannot be undone.')) {
          state = Object.assign(defaults(), { settings: state.settings, mix: state.mix });
          save();
          closeOverlay();
          toast('Progress cleared');
          go('#/');
        }
        break;
      default: return false;
    }
    return true;
  }

  /* ---------- theme & toast ---------- */
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => state.settings.theme === 'dark' || (state.settings.theme === 'system' && darkQuery.matches);
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    $('themeBtn').innerHTML = ic(isDark() ? 'sun' : 'moon');
    $('themeBtn').setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ---------- events ---------- */
  app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === 'home') { go('#/'); return; }
    if (act === 'smart' && view.name === 'results') { onHomeAct('smart', el); return; }
    if (act === 'mock' && view.name === 'results') { openMockSetup(); return; }
    if (view.name === 'quiz') onQuizAct(act, el);
    else if (view.name === 'results') onResultsAct(act, el);
    else onHomeAct(act, el);
  });

  overlay.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closeOverlay(); return; }
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) onOverlayAct(el.dataset.act, el);
  });

  $('themeBtn').addEventListener('click', () => {
    state.settings.theme = isDark() ? 'light' : 'dark';
    save();
    applyTheme();
  });
  $('settingsBtn').innerHTML = ic('sliders');
  $('settingsBtn').addEventListener('click', openSettings);
  darkQuery.addEventListener('change', applyTheme);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlayOpen()) {
      if (e.key === 'Escape') closeOverlay();
      return;
    }
    if (view.name !== 'quiz') return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.key === 'Enter' || e.key === ' ') && tag === 'BUTTON') return; // let the focused button handle it
    const k = e.key.toLowerCase();
    const pos = k.length === 1 ? Math.max('abcd'.indexOf(k), '1234'.indexOf(k)) : -1;
    const s = cur();
    if (pos >= 0) { e.preventDefault(); choose(pos); }
    else if (k === 'arrowright') { e.preventDefault(); move(1); }
    else if (k === 'arrowleft') { e.preventDefault(); move(-1); }
    else if (k === 'enter' && s && (revealed(s, s.items[s.idx]) || isLive(s))) { e.preventDefault(); next(); }
    else if (k === 'f') toggleFlag();
    else if (k === 'g') openNavigator();
  });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitImages);
  });
  window.addEventListener('hashchange', route);

  save(); // persists progress migrated from the previous version on first load
  applyTheme();
  route();
})();
