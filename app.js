(function () {
  'use strict';
  var Q = window.QUIZ, EX = Q.exams, KB = Q.kbase + 24;
  var LS_KEY = 'ipq_v2';
  var LET = ['A', 'B', 'C', 'D'];
  var YEARS = [2024, 2023, 2022];

  var $ = function (id) { return document.getElementById(id); };
  var card = $('card'), tabsEl = $('tabs');
  var showSummary = false;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function getQ(e, n) { return EX[e].qs[n - 1]; }
  function keyOf(it) { return it.e + '-' + it.n; }

  /* ---------- state ---------- */
  function fresh(keepShuffle) {
    return {
      mode: 0,
      shuffle: keepShuffle === undefined ? true : keepShuffle,
      sess: EX.map(function () { return { idx: 0, answered: {}, perm: {} }; }),
      rand: { sel: EX.map(function () { return true; }), count: 'all', run: null }
    };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && s.sess && s.sess.length === EX.length && s.rand && s.rand.sel && s.rand.sel.length === EX.length) return s;
    } catch (e) { /* ignore */ }
    return null;
  }
  var state = load() || fresh();
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  var examItems = EX.map(function (ex, e) { return ex.qs.map(function (q) { return { e: e, n: q.n }; }); });

  function ctxNow() {
    if (state.mode >= 0) {
      return { items: examItems[state.mode], sess: state.sess[state.mode], rand: false, label: EX[state.mode].label + ' \u00b7 ' + EX[state.mode].sub };
    }
    var run = state.rand.run;
    if (!run) return null;
    return { items: run.items, sess: run, rand: true, label: 'Random mix \u00b7 ' + run.items.length + ' questions' };
  }

  function getPerm(sess, it, q) {
    var k = keyOf(it);
    if (!sess.perm[k]) {
      sess.perm[k] = (state.shuffle && q.o) ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3];
    }
    return sess.perm[k];
  }
  function scoreOf(ctx) {
    var c = 0, a = 0;
    ctx.items.forEach(function (it) {
      var v = ctx.sess.answered[keyOf(it)];
      if (v !== undefined) { a++; if (v === getQ(it.e, it.n).a) c++; }
    });
    return { correct: c, attempted: a };
  }

  /* ---------- tabs ---------- */
  function buildTabs() {
    tabsEl.innerHTML = '';
    EX.forEach(function (ex, e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = ex.label;
      if (state.mode === e) b.className = 'active';
      b.onclick = function () { state.mode = e; showSummary = false; save(); render(true); };
      tabsEl.appendChild(b);
    });
    var m = document.createElement('button');
    m.type = 'button';
    m.textContent = '\u{1F500} Random mix';
    m.className = 'mix' + (state.mode === -1 ? ' active' : '');
    m.onclick = function () { state.mode = -1; showSummary = false; save(); render(true); };
    tabsEl.appendChild(m);
  }

  function setScale() {
    var inner = card.clientWidth - 36;
    var k = Math.max(0.62, Math.min(1.1, inner / KB));
    card.style.setProperty('--k', k.toFixed(4));
  }

  function scrollToCard() {
    var y = card.getBoundingClientRect().top + window.pageYOffset - 70;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  /* ---------- render ---------- */
  function render(scroll) {
    buildTabs();
    $('shuffleToggle').checked = !!state.shuffle;
    setScale();
    if (state.mode === -1 && !state.rand.run) renderSetup();
    else if (showSummary) renderSummary();
    else renderQuiz();
    if (scroll) scrollToCard();
  }

  function renderSetup() {
    var sel = state.rand.sel;
    var h = '<div class="setup"><h2>Random mix</h2>' +
      '<p class="lead">Choose which exams to draw questions from. Questions are shuffled together.</p>';
    YEARS.forEach(function (yr) {
      var idxs = [];
      EX.forEach(function (ex, e) { if (ex.year === yr) idxs.push(e); });
      var allOn = idxs.every(function (e) { return sel[e]; });
      h += '<div class="ygroup"><span class="yl">' + yr + '</span>' +
        '<button type="button" class="chip' + (allOn ? ' on' : '') + '" data-year="' + yr + '">Whole year</button>';
      idxs.forEach(function (e) {
        h += '<button type="button" class="chip' + (sel[e] ? ' on' : '') + '" data-exam="' + e + '">' + esc(EX[e].label) + '</button>';
      });
      h += '</div>';
    });
    var pool = 0, n = 0;
    EX.forEach(function (ex, e) { if (sel[e]) { pool += ex.qs.length; n++; } });
    var cnt = state.rand.count;
    h += '<div class="row"><button type="button" class="chip" id="selAll">Select all</button>' +
      '<button type="button" class="chip" id="selNone">Clear</button></div>' +
      '<div class="row"><label>Questions: <select id="cnt">';
    ['10', '25', '50', '100', 'all'].forEach(function (v) {
      h += '<option value="' + v + '"' + (String(cnt) === v ? ' selected' : '') + '>' + (v === 'all' ? 'All' : v) + '</option>';
    });
    h += '</select></label><span class="poolinfo">' + pool + ' questions available from ' + n + ' exam' + (n === 1 ? '' : 's') + '</span></div>' +
      '<button type="button" class="btn" id="startRand"' + (pool ? '' : ' disabled') + '>Start mix</button></div>';
    card.innerHTML = h;
    $('statLeft').textContent = 'Random mix';
    $('statRight').textContent = 'Pick your exams';
    $('progressFill').style.width = '0%';

    card.querySelectorAll('[data-exam]').forEach(function (b) {
      b.onclick = function () { var e = +b.dataset.exam; sel[e] = !sel[e]; save(); renderSetup(); };
    });
    card.querySelectorAll('[data-year]').forEach(function (b) {
      b.onclick = function () {
        var yr = +b.dataset.year, idxs = [];
        EX.forEach(function (ex, e) { if (ex.year === yr) idxs.push(e); });
        var on = !idxs.every(function (e) { return sel[e]; });
        idxs.forEach(function (e) { sel[e] = on; });
        save(); renderSetup();
      };
    });
    $('selAll').onclick = function () { EX.forEach(function (_, e) { sel[e] = true; }); save(); renderSetup(); };
    $('selNone').onclick = function () { EX.forEach(function (_, e) { sel[e] = false; }); save(); renderSetup(); };
    $('cnt').onchange = function (ev) { state.rand.count = ev.target.value; save(); };
    $('startRand').onclick = function () {
      var items = [];
      EX.forEach(function (ex, e) { if (sel[e]) items = items.concat(examItems[e]); });
      items = shuffle(items);
      var c = state.rand.count;
      if (c !== 'all') items = items.slice(0, +c);
      startRun(items);
    };
  }

  function startRun(items) {
    state.mode = -1;
    state.rand.run = { items: items, idx: 0, answered: {}, perm: {} };
    showSummary = false;
    save();
    render(true);
  }

  function expHtml(q, o, ans, letter) {
    var ok = (o === q.a);
    return '<div class="exp ' + (ok ? 'ok' : 'no') + '"><span class="tag">' +
      (letter ? letter + ' \u2014 ' : '') + (ok ? '\u2713 CORRECT' : '\u2717 NOT CORRECT') + '</span>' +
      esc(q.x[o] || 'No explanation available.') +
      (o === ans ? '<span class="mine">your pick</span>' : '') + '</div>';
  }

  function renderQuiz() {
    var ctx = ctxNow();
    var sess = ctx.sess, items = ctx.items;
    var it = items[sess.idx], ex = EX[it.e], q = getQ(it.e, it.n);
    var ky = keyOf(it), ans = sess.answered[ky], answered = ans !== undefined;
    var perm = getPerm(sess, it, q);
    var sc = scoreOf(ctx);

    $('statLeft').textContent = 'Question ' + (sess.idx + 1) + ' / ' + items.length + '  \u00b7  ' + ctx.label;
    $('statRight').textContent = 'Score: ' + sc.correct + ' / ' + sc.attempted;
    $('progressFill').style.width = (sc.attempted / items.length * 100) + '%';

    var jump = '';
    items.forEach(function (x, i) {
      var v = sess.answered[keyOf(x)];
      var mark = v === undefined ? '' : (v === getQ(x.e, x.n).a ? ' \u2713' : ' \u2717');
      jump += '<option value="' + i + '"' + (i === sess.idx ? ' selected' : '') + '>Q' + (i + 1) + mark + '</option>';
    });
    var title = ctx.rand
      ? 'Mix \u2014 Q' + (sess.idx + 1) + ' <span class="source-note">from ' + esc(ex.label) + ', original Q' + it.n + '</span>'
      : esc(ex.label) + ' \u2014 Q' + it.n;

    var correctPos = perm.indexOf(q.a);
    var verdict = '<div class="verdict">&nbsp;</div>';
    if (answered) {
      verdict = ans === q.a
        ? '<div class="verdict ok">\u2713 Correct! The answer is ' + LET[correctPos] + '.</div>'
        : '<div class="verdict no">\u2717 Not quite. The correct answer is ' + LET[correctPos] + '.</div>';
    }

    var body = '';
    var base = 'img/' + ex.key + '/';
    if (q.o) {
      body += '<div class="stem"><img style="--w:' + q.s[1] + '" src="' + base + q.s[0] + '" alt="Question ' + it.n + '"></div>' + verdict;
      for (var pos = 0; pos < 4; pos++) {
        var o = perm[pos], cls = 'opt';
        if (answered) cls += (o === q.a) ? ' correct' : (o === ans ? ' wrong' : ' dim');
        body += '<div class="opt-row"><button type="button" class="' + cls + '" data-pos="' + pos + '"' + (answered ? ' disabled' : '') + '>' +
          '<span class="badge">' + LET[pos] + '</span>' +
          '<span class="oimg"><img style="--w:' + q.o[o][1] + '" src="' + base + q.o[o][0] + '" alt="Choice ' + LET[pos] + '"></span></button>' +
          (answered ? expHtml(q, o, ans) : '') + '</div>';
      }
    } else {
      body += '<div class="full"><img style="--w:' + q.f[1] + '" src="' + base + q.f[0] + '" alt="Question ' + it.n + '"></div>' + verdict + '<div class="letters">';
      for (var p2 = 0; p2 < 4; p2++) {
        var c2 = 'opt';
        if (answered) c2 += (p2 === q.a) ? ' correct' : (p2 === ans ? ' wrong' : ' dim');
        body += '<button type="button" class="' + c2 + '" data-pos="' + p2 + '"' + (answered ? ' disabled' : '') + '>' + LET[p2] + '</button>';
      }
      body += '</div>';
      if (answered) for (var p3 = 0; p3 < 4; p3++) body += expHtml(q, p3, ans, LET[p3]);
    }

    var mid = ctx.rand ? 'New mix' : 'Reset exam';
    var last = sess.idx === items.length - 1;
    card.innerHTML =
      '<div class="qhead"><span>' + title + '</span><span class="jump">Jump: <select id="jump">' + jump + '</select></span></div>' +
      body +
      '<div class="nav"><button type="button" class="btn secondary" id="prev"' + (sess.idx === 0 ? ' disabled' : '') + '>&larr; Prev</button>' +
      '<button type="button" class="btn secondary" id="mid">' + mid + '</button>' +
      '<button type="button" class="btn" id="next">' + (last ? 'See results &rarr;' : 'Next &rarr;') + '</button></div>';

    card.querySelectorAll('.opt[data-pos]').forEach(function (b) {
      b.onclick = function () { answerPos(+b.dataset.pos); };
    });
    $('prev').onclick = function () { if (sess.idx > 0) { sess.idx--; save(); render(true); } };
    $('next').onclick = goNext;
    $('jump').onchange = function (ev) { sess.idx = +ev.target.value; save(); render(true); };
    $('mid').onclick = function () {
      if (ctx.rand) {
        if (confirm('Leave this mix and choose a new one? Your answers in this mix will be cleared.')) {
          state.rand.run = null; save(); render(true);
        }
      } else if (confirm('Reset your answers for ' + ex.label + '?')) {
        state.sess[state.mode] = { idx: 0, answered: {}, perm: {} }; save(); render(true);
      }
    };
    preload(items, sess.idx + 1);
  }

  function answerPos(pos) {
    var ctx = ctxNow(); if (!ctx) return;
    var it = ctx.items[ctx.sess.idx], q = getQ(it.e, it.n), ky = keyOf(it);
    if (ctx.sess.answered[ky] !== undefined) return;
    var perm = getPerm(ctx.sess, it, q);
    ctx.sess.answered[ky] = perm[pos];
    save();
    render(false);
  }
  function goNext() {
    var ctx = ctxNow(); if (!ctx) return;
    if (ctx.sess.idx < ctx.items.length - 1) { ctx.sess.idx++; save(); render(true); }
    else { showSummary = true; render(true); }
  }

  var preloaded = {};
  function preload(items, i) {
    var it = items[i]; if (!it) return;
    var ky = keyOf(it); if (preloaded[ky]) return; preloaded[ky] = 1;
    var q = getQ(it.e, it.n), base = 'img/' + EX[it.e].key + '/', list = [];
    if (q.o) { list.push(q.s[0]); q.o.forEach(function (o) { list.push(o[0]); }); } else list.push(q.f[0]);
    list.forEach(function (f) { var im = new Image(); im.src = base + f; });
  }

  function renderSummary() {
    var ctx = ctxNow();
    var sc = scoreOf(ctx);
    var pct = sc.attempted ? Math.round(sc.correct / sc.attempted * 100) : 0;
    var missed = [], missedItems = [];
    ctx.items.forEach(function (it, i) {
      var q = getQ(it.e, it.n), v = ctx.sess.answered[keyOf(it)];
      if (v !== undefined && v !== q.a) {
        var perm = ctx.sess.perm[keyOf(it)] || [0, 1, 2, 3];
        var tag = ctx.rand ? ' (' + EX[it.e].label + ' Q' + it.n + ')' : '';
        missed.push('Q' + (ctx.rand ? i + 1 : it.n) + tag + ': you chose ' + LET[perm.indexOf(v)] + ', correct is ' + LET[perm.indexOf(q.a)]);
        missedItems.push(it);
      }
    });
    $('statLeft').textContent = 'Results \u00b7 ' + ctx.label;
    $('statRight').textContent = 'Score: ' + sc.correct + ' / ' + sc.attempted;
    $('progressFill').style.width = '100%';
    card.innerHTML = '<div class="summary"><div class="sub">' + esc(ctx.label) + '</div>' +
      '<div class="big">' + pct + '%</div>' +
      '<div class="sub">' + sc.correct + ' correct out of ' + sc.attempted + ' answered (' + ctx.items.length + ' total)</div>' +
      (missed.length ? '<div class="missed"><strong>Review these:</strong><br>' + missed.map(esc).join('<br>') + '</div>' : '<div class="sub">No mistakes in what you answered. Nice work.</div>') +
      '<div class="btns"><button type="button" class="btn secondary" id="back">Review questions</button>' +
      (missedItems.length ? '<button type="button" class="btn" id="retryMissed">Retry missed (' + missedItems.length + ')</button>' : '') +
      '<button type="button" class="btn secondary" id="again">' + (ctx.rand ? 'New mix' : 'Retry this exam') + '</button></div></div>';
    $('back').onclick = function () { showSummary = false; ctx.sess.idx = 0; save(); render(true); };
    if ($('retryMissed')) $('retryMissed').onclick = function () { startRun(shuffle(missedItems)); };
    $('again').onclick = function () {
      showSummary = false;
      if (ctx.rand) state.rand.run = null; else state.sess[state.mode] = { idx: 0, answered: {}, perm: {} };
      save(); render(true);
    };
  }

  /* ---------- global controls ---------- */
  $('shuffleToggle').onchange = function (ev) {
    state.shuffle = ev.target.checked;
    function clean(s) { Object.keys(s.perm).forEach(function (k) { if (s.answered[k] === undefined) delete s.perm[k]; }); }
    state.sess.forEach(clean);
    if (state.rand.run) clean(state.rand.run);
    save(); render(false);
  };
  $('resetAll').onclick = function () {
    if (confirm('Clear all saved answers and progress for every exam?')) {
      state = fresh(state.shuffle); showSummary = false; save(); render(true);
    }
  };
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'SELECT' || tag === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (state.mode === -1 && !state.rand.run) return;
    if (showSummary) return;
    var k = ev.key.toLowerCase();
    if ('abcd'.indexOf(k) >= 0 && k.length === 1) { answerPos('abcd'.indexOf(k)); }
    else if (k === 'arrowright' || k === 'enter') { var c = ctxNow(); if (c && c.sess.answered[keyOf(c.items[c.sess.idx])] !== undefined) goNext(); }
    else if (k === 'arrowleft') { var c2 = ctxNow(); if (c2 && c2.sess.idx > 0) { c2.sess.idx--; save(); render(true); } }
  });
  window.addEventListener('resize', setScale);

  render(false);
})();
