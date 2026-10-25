// Admin panel: usage analytics and testimonial moderation, backed by Firebase.
// Open admin.html?demo=1 to preview the panel with made-up sample data before Firebase is set up.
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const cfg = window.FIREBASE_CONFIG || {};
const root = document.getElementById('admin');
const userBox = document.getElementById('adminUser');
const tip = document.getElementById('tip');
const DEMO = new URLSearchParams(location.search).has('demo');
// What visitors rate in the "Share your story" form (same ids as app.js and firestore.rules).
const RATE_ASPECTS = [['overall', 'Overall'], ['explanations', 'Explanations'], ['lessons', 'Lessons and flashcards'], ['ease', 'Ease of use']];

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => new Intl.NumberFormat('en', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const phDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const shortDay = key => new Date(key + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
const when = ms => (ms ? new Date(ms).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function dayKeys(count) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) keys.push(phDay(new Date(Date.now() - i * 86400000)));
  return [...new Set(keys)];
}

/* ---------- backends ---------- */
async function firebaseBackend() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore-lite.js')
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const pubRef = F.doc(db, 'public', 'testimonials');
  return {
    onUser: fn => A.onAuthStateChanged(auth, fn),
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, provider); } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await A.signInWithRedirect(auth, provider);
        else throw e;
      }
    },
    signOut: () => A.signOut(auth),
    async isAdmin() {
      try { await F.getDocs(F.query(F.collection(db, 'submissions'), F.limit(1))); return true; } catch (e) {
        if (e.code === 'permission-denied') return false;
        throw e;
      }
    },
    async stats(keys) {
      const snap = await F.getDocs(F.query(F.collection(db, 'stats'), F.where(F.documentId(), '>=', keys[0]), F.orderBy(F.documentId())));
      const out = {};
      snap.forEach(d => { out[d.id] = d.data(); });
      return out;
    },
    async pending() {
      const snap = await F.getDocs(F.query(F.collection(db, 'submissions'), F.where('status', '==', 'pending')));
      const list = [];
      snap.forEach(d => { const v = d.data(); list.push({ id: d.id, ...v, at: v.createdAt && v.createdAt.toMillis ? v.createdAt.toMillis() : 0 }); });
      return list.sort((a, b) => b.at - a.at);
    },
    async published() {
      const snap = await F.getDoc(pubRef);
      return snap.exists() && Array.isArray(snap.data().items) ? snap.data().items : [];
    },
    savePublished: items => F.setDoc(pubRef, { items, updatedAt: F.serverTimestamp() }),
    setStatus: (id, status) => F.updateDoc(F.doc(db, 'submissions', id), { status }).catch(() => {}),
    remove: id => F.deleteDoc(F.doc(db, 'submissions', id))
  };
}

function demoBackend() {
  // Made-up numbers so the layout can be previewed; nothing is saved.
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const stats = {};
  dayKeys(90).forEach((k, i) => {
    const v = Math.round(20 + i * 0.6 + rnd() * 25 + (i % 7 > 4 ? 15 : 0));
    const ans = Math.round(v * (6 + rnd() * 8));
    const h = {};
    for (let x = 0; x < 24; x++) { const base = x >= 19 && x <= 23 ? 3 : x >= 8 && x <= 17 ? 1.5 : 0.3; const c = Math.round(base * v / 30 * (0.5 + rnd())); if (c) h[String(x).padStart(2, '0')] = c; }
    stats[k] = { visitors: v, visits: Math.round(v * 1.4), newVisitors: Math.round(v * 0.35), mobile: Math.round(v * 1.4 * 0.7), desktop: Math.round(v * 1.4 * 0.3),
      refDirect: Math.round(v * 0.5), refSocial: Math.round(v * 0.6), refSearch: Math.round(v * 0.25), refOther: Math.round(v * 0.05),
      answers: ans, correct: Math.round(ans * (0.55 + rnd() * 0.2)), mocks: Math.round(v * 0.08), lessons: Math.round(v * 0.9), flashcards: Math.round(v * 3),
      stories: rnd() > 0.8 ? 1 : 0, h, ex: { '2026S': Math.round(ans * 0.3), '2025A': Math.round(ans * 0.2), '2025S': Math.round(ans * 0.15), '2024A': Math.round(ans * 0.12), '2024S': Math.round(ans * 0.1), '2022S': Math.round(ans * 0.05) } };
    // a few ratings every third day, from a fixed pattern so the other sample numbers stay the same
    if (i % 3 === 0) stats[k].rt = { overallSum: 9, overallCount: 2, explanationsSum: 10, explanationsCount: 2, lessonsSum: 4, lessonsCount: 1, easeSum: 8 + i % 2, easeCount: 2 };
  });
  let pending = [
    { id: 'p1', name: 'Demo Student', exam: 'October 2026', result: 'Passed', message: 'Sample submission for previewing the admin panel. The flashcards helped with the strategy terms.', ratings: { overall: 5, explanations: 5, lessons: 4, ease: 5 }, at: Date.now() - 3600000 },
    { id: 'p2', name: 'Sample Name', exam: 'Not taken yet', result: '', message: 'Another sample submission used only in demo mode.', ratings: { overall: 4, ease: 3 }, at: Date.now() - 86400000 }
  ];
  let published = [{ id: 'x1', name: 'Demo Reviewer', detail: 'Passed, October 2026', text: 'Sample published testimonial shown only in demo mode.', at: Date.now() - 5 * 86400000 }];
  const user = { email: 'demo@example.com', uid: 'demo-user' };
  return {
    onUser: fn => fn(user),
    signIn: async () => {}, signOut: async () => location.reload(),
    isAdmin: async () => true,
    stats: async keys => Object.fromEntries(keys.filter(k => stats[k]).map(k => [k, stats[k]])),
    pending: async () => pending.slice(),
    published: async () => published.slice(),
    savePublished: async items => { published = items.slice(); },
    setStatus: async id => { pending = pending.filter(p => p.id !== id); },
    remove: async id => { pending = pending.filter(p => p.id !== id); }
  };
}

/* ---------- screens ---------- */
let api = null;
let ui = { tab: 'overview', range: 30, metric: 'visitors', storyTab: 'pending' };
let data = { stats: null, keys: [], pending: [], published: [] };

function message(title, html) {
  root.innerHTML = `<section class="card admin-msg"><h1>${title}</h1>${html}</section>`;
}

function showUser(user) {
  userBox.innerHTML = user
    ? `<span class="admin-email">${esc(user.email || '')}</span><button type="button" class="btn sm" id="signOut">Sign out</button>`
    : '';
  if (user) document.getElementById('signOut').onclick = () => api.signOut();
}

// Turns the errors of an unfinished Firebase setup into the step that fixes them.
function explainError(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed') {
    return 'Google sign-in is not turned on yet. In the Firebase console: Authentication > Get started > Sign-in method > Google > Enable > Save.';
  }
  if (code === 'auth/unauthorized-domain') {
    return `Add ${location.hostname} in the Firebase console: Authentication > Settings > Authorized domains.`;
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'not-found') {
    return 'The Firestore database does not exist yet. In the Firebase console: Firestore Database > Create database.';
  }
  return (e && e.message) || String(e);
}

function signInScreen(error) {
  showUser(null);
  message('Sign in', `<p class="muted">Sign in with the Google account that is listed as an admin in the Firestore rules.</p>
    ${error ? `<p class="form-error">${esc(error)}</p>` : ''}
    <button type="button" class="btn primary" id="signIn">Sign in with Google</button>`);
  document.getElementById('signIn').onclick = () => api.signIn().catch(e => signInScreen(explainError(e)));
}

function notAdminScreen(user) {
  message('This account is not an admin yet', `<p>You are signed in as <b>${esc(user.email)}</b>. To make it an admin:</p>
    <ol class="steps">
      <li>Copy your user ID: <code id="uid">${esc(user.uid)}</code> <button type="button" class="btn sm" id="copyUid">Copy</button></li>
      <li>In <code>firestore.rules</code>, add it to the list of admin user IDs in <code>isAdmin()</code>.</li>
      <li>Paste the rules into Firebase console &gt; Firestore Database &gt; Rules and click <b>Publish</b>.</li>
      <li>Reload this page.</li>
    </ol>`);
  document.getElementById('copyUid').onclick = e => {
    navigator.clipboard.writeText(user.uid).then(() => { e.target.textContent = 'Copied'; }).catch(() => {});
  };
}

async function panel() {
  root.innerHTML = `
    ${DEMO ? '<p class="demo-banner">Demo mode: made-up sample data. Nothing here is real or saved.</p>' : ''}
    <div class="admin-head">
      <h1>Dashboard</h1>
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-tab="overview">Overview</button>
        <button type="button" role="tab" data-tab="stories">Testimonials <span class="count" id="pendingCount"></span></button>
      </div>
    </div>
    <div id="tabBody"></div>`;
  root.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { ui.tab = b.dataset.tab; drawTab(); }; });
  await Promise.all([loadStats(), loadStories()]);
  drawTab();
}

async function loadStats() {
  data.keys = dayKeys(ui.range);
  data.stats = await api.stats(data.keys);
}

async function loadStories() {
  [data.pending, data.published] = await Promise.all([api.pending(), api.published()]);
}

function drawTab() {
  root.querySelectorAll('[data-tab]').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === ui.tab);
    b.setAttribute('aria-selected', b.dataset.tab === ui.tab);
  });
  document.getElementById('pendingCount').textContent = data.pending.length ? data.pending.length : '';
  if (ui.tab === 'overview') drawOverview(); else drawStories();
}

/* ---------- overview ---------- */
function totals() {
  const t = { ex: {}, h: {}, rt: {} };
  data.keys.forEach(k => {
    const d = data.stats[k] || {};
    Object.keys(d).forEach(f => {
      if (typeof d[f] === 'number') t[f] = (t[f] || 0) + d[f];
      else if (d[f] && typeof d[f] === 'object' && t[f]) Object.keys(d[f]).forEach(s => { t[f][s] = (t[f][s] || 0) + d[f][s]; });
    });
  });
  return t;
}

function drawOverview() {
  const t = totals();
  const v = f => t[f] || 0;
  const kpi = (label, value, note, hero) => `<div class="kpi${hero ? ' hero' : ''}"><span class="kpi-label">${label}</span><b>${fmt(value)}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  const METRICS = { visitors: 'Visitors', answers: 'Questions answered', visits: 'Visits' };
  const devices = [['Phones and tablets', v('mobile')], ['Computers', v('desktop')]];
  const sources = [['Direct or bookmarked', v('refDirect')], ['Social media', v('refSocial')], ['Search engines', v('refSearch')], ['Other sites', v('refOther')]];
  const exams = Object.keys(t.ex).map(k => [examLabel(k), t.ex[k]]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const hours = Array.from({ length: 24 }, (_, i) => { const k = String(i).padStart(2, '0'); return { label: hourLabel(i), value: t.h[k] || 0 }; });
  const days = data.keys.map(k => ({ label: shortDay(k), key: k, value: (data.stats[k] || {})[ui.metric] || 0 }));
  const empty = !v('visits') && !v('answers');

  document.getElementById('tabBody').innerHTML = `
    <div class="filter-row">
      <div class="seg" aria-label="Date range">${[7, 30, 90].map(n => `<button type="button" data-range="${n}" class="${ui.range === n ? 'on' : ''}">${n} days</button>`).join('')}</div>
      <button type="button" class="btn sm ghost" id="refresh">Refresh</button>
    </div>
    ${empty ? '<p class="muted admin-note">No visits recorded in this period yet. Numbers appear here as people use the site.</p>' : ''}
    <div class="kpis">
      ${kpi('Visitors', v('visitors'), 'Counted once per person per day', true)}
      ${kpi('Visits', v('visits'), 'Times the site was opened')}
      ${kpi('New visitors', v('newVisitors'), 'First visit ever')}
      ${kpi('Questions answered', v('answers'), v('answers') ? pct(v('correct'), v('answers')) + '% answered correctly' : '')}
      ${kpi('Mock exams', v('mocks'), 'Submitted')}
      ${kpi('Lessons opened', v('lessons'), '')}
      ${kpi('Flashcards studied', v('flashcards'), '')}
    </div>
    <section class="card chart-card">
      <div class="chart-head">
        <h2>Daily ${METRICS[ui.metric].toLowerCase()}</h2>
        <div class="seg sm" aria-label="Measure">${Object.keys(METRICS).map(m => `<button type="button" data-metric="${m}" class="${ui.metric === m ? 'on' : ''}">${METRICS[m]}</button>`).join('')}</div>
      </div>
      <div class="chart" id="trend"></div>
      <details class="table-view"><summary>Show as a table</summary>
        <div class="table-scroll"><table><thead><tr><th>Day</th><th>Visitors</th><th>Visits</th><th>New</th><th>Questions</th><th>Mocks</th><th>Lessons</th></tr></thead><tbody>
          ${data.keys.slice().reverse().map(k => { const d = data.stats[k] || {}; return `<tr><td>${shortDay(k)}</td><td>${d.visitors || 0}</td><td>${d.visits || 0}</td><td>${d.newVisitors || 0}</td><td>${d.answers || 0}</td><td>${d.mocks || 0}</td><td>${d.lessons || 0}</td></tr>`; }).join('')}
        </tbody></table></div>
      </details>
    </section>
    <div class="chart-grid">
      <section class="card chart-card"><div class="chart-head"><h2>Busiest hours</h2><span class="muted">Visits by hour, Philippine time</span></div><div class="chart" id="hours"></div></section>
      <section class="card chart-card"><div class="chart-head"><h2>Devices</h2><span class="muted">Share of visits</span></div>${barList(devices)}</section>
      <section class="card chart-card"><div class="chart-head"><h2>Where visitors come from</h2><span class="muted">First page of each visit</span></div>${barList(sources)}</section>
      <section class="card chart-card"><div class="chart-head"><h2>Most practiced exams</h2><span class="muted">Questions answered</span></div>${exams.length ? barList(exams) : '<p class="muted">No answers yet.</p>'}</section>
    </div>
    <section class="card chart-card ratings-card"><div class="chart-head"><h2>Ratings</h2><span class="muted">Average stars from the Share your story form. Not shown on the site.</span></div>${ratingList(t.rt)}</section>
    ${cfg.measurementId && !DEMO ? `<p class="admin-note">Countries, cities, browsers and real-time visitors are in Google Analytics:
      <a href="https://console.firebase.google.com/project/${encodeURIComponent(cfg.projectId)}/analytics" target="_blank" rel="noopener">open Firebase Analytics</a>.</p>` : ''}`;

  columnChart(document.getElementById('trend'), days, { height: 220 });
  columnChart(document.getElementById('hours'), hours, { height: 160 });

  document.querySelectorAll('[data-range]').forEach(b => { b.onclick = () => reloadStats(+b.dataset.range); });
  document.querySelectorAll('[data-metric]').forEach(b => { b.onclick = () => { ui.metric = b.dataset.metric; drawOverview(); }; });
  document.getElementById('refresh').onclick = () => reloadStats(ui.range);
}

async function reloadStats(range) {
  ui.range = range;
  const body = document.getElementById('tabBody');
  body.classList.add('loading');
  try { await loadStats(); } finally { body.classList.remove('loading'); }
  drawOverview();
}

function examLabel(key) {
  const m = /^(\d{4})([SA])$/.exec(key);
  return m ? (m[2] === 'A' ? 'October ' : 'April ') + m[1] : key;
}

function hourLabel(h) {
  return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
}

function barList(rows) {
  const total = rows.reduce((n, r) => n + r[1], 0);
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<ul class="barlist">${rows.map(([label, value]) => `<li>
      <span class="bl-label">${esc(label)}</span>
      <span class="bl-track"><span class="bl-fill" style="width:${value ? Math.max(2, value / max * 100) : 0}%"></span></span>
      <span class="bl-value">${fmt(value)}<small>${pct(value, total)}%</small></span>
    </li>`).join('')}</ul>`;
}

// Average rating per aspect (1-5 stars) as a meter out of 5, with how many people rated it.
function ratingList(rt) {
  if (!RATE_ASPECTS.some(([id]) => rt[id + 'Count'])) return '<p class="muted">No ratings in this period yet. They come from the Share your story form.</p>';
  return `<ul class="barlist rating-list">${RATE_ASPECTS.map(([id, label]) => {
    const n = rt[id + 'Count'] || 0, avg = n ? (rt[id + 'Sum'] || 0) / n : 0;
    return `<li>
      <span class="bl-label">${esc(label)}</span>
      <span class="bl-track" role="meter" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${avg.toFixed(1)}" aria-label="${esc(label)}"><span class="bl-fill" style="width:${avg / 5 * 100}%"></span></span>
      <span class="bl-value">${n ? avg.toFixed(1) : '–'}<small>${n} ${n === 1 ? 'rating' : 'ratings'}</small></span>
    </li>`;
  }).join('')}</ul>`;
}

function ratingSummary(r) {
  const parts = RATE_ASPECTS.filter(([id]) => r && r[id]).map(([id, label]) => label + ' ' + r[id] + '★');
  return parts.length ? parts.join(' · ') : 'No ratings';
}

// Single-series column chart: thin columns with rounded tops, hairline grid, a tooltip on hover and focus.
function columnChart(box, points, opts) {
  const W = box.clientWidth || 300, H = opts.height;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const maxVal = Math.max(...points.map(p => p.value), 0);
  if (!maxVal) { box.innerHTML = '<p class="muted chart-empty">No data for this period yet.</p>'; return; }
  const step = niceStep(maxVal / 4);
  const top = Math.ceil(maxVal / step) * step;
  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = v => pad.t + plotH - v / top * plotH;
  const every = Math.ceil(points.length / Math.max(1, Math.floor(plotW / 56)));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.label || 'Column chart')}">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  points.forEach((p, i) => {
    const x = pad.l + i * slot + (slot - barW) / 2, h = p.value / top * plotH, base = pad.t + plotH;
    if (h > 0) {
      const r = Math.min(4, h, barW / 2);
      svg += `<path class="col" data-i="${i}" d="M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z"/>`;
    }
    if (i % every === 0) svg += `<text class="tick" x="${pad.l + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  points.forEach((p, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${plotH}" tabindex="0" aria-label="${esc(p.label)}: ${p.value}"/>`;
  });
  box.innerHTML = svg + '</svg>';
  const show = (el, i) => {
    box.querySelectorAll('.col').forEach(c => c.classList.toggle('on', +c.dataset.i === i));
    tip.textContent = '';
    const b = document.createElement('b'); b.textContent = fmt(points[i].value);
    const s = document.createElement('span'); s.textContent = points[i].label;
    tip.append(b, s);
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
    tip.style.left = left + window.scrollX + 'px';
    tip.style.top = Math.max(8, r.top + window.scrollY + (y(points[i].value) - pad.t) * (r.height / plotH) - tip.offsetHeight - 8) + 'px';
  };
  const hide = () => { tip.hidden = true; box.querySelectorAll('.col.on').forEach(c => c.classList.remove('on')); };
  box.querySelectorAll('.hit').forEach(h => {
    const i = +h.dataset.i;
    h.addEventListener('pointerenter', () => show(h, i));
    h.addEventListener('focus', () => show(h, i));
    h.addEventListener('pointerleave', hide);
    h.addEventListener('blur', hide);
  });
}

function niceStep(raw) {
  if (raw <= 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/* ---------- testimonials ---------- */
function drawStories() {
  const pending = data.pending, published = data.published;
  const body = document.getElementById('tabBody');
  body.innerHTML = `
    <div class="filter-row">
      <div class="seg">
        <button type="button" data-st="pending" class="${ui.storyTab === 'pending' ? 'on' : ''}">Waiting for review (${pending.length})</button>
        <button type="button" data-st="published" class="${ui.storyTab === 'published' ? 'on' : ''}">On the site (${published.length})</button>
      </div>
      <button type="button" class="btn sm ghost" id="refreshStories">Refresh</button>
    </div>
    <p class="admin-note muted">${ui.storyTab === 'pending'
      ? 'Nothing is shown on the site until you publish it. You can fix typos before publishing.'
      : 'These appear in the home page carousel in this order. Visitors may see changes up to 30 minutes later.'}</p>
    <div class="story-list" id="storyList"></div>`;
  const list = document.getElementById('storyList');
  if (ui.storyTab === 'pending') {
    list.innerHTML = pending.length ? pending.map(s => `<article class="card story" data-id="${esc(s.id)}">
        <div class="story-meta"><b>${esc(s.name)}</b><span>${esc([s.result, s.exam].filter(Boolean).join(' · ') || 'No exam details')}</span><span>${esc(when(s.at))}</span></div>
        <div class="story-meta story-ratings">${esc(ratingSummary(s.ratings))}</div>
        <label class="fld"><span>Name to show</span><input data-f="name" maxlength="40" value="${esc(s.name)}"></label>
        <label class="fld"><span>Line under the name</span><input data-f="detail" maxlength="60" value="${esc([s.result, s.exam].filter(Boolean).join(', '))}"></label>
        <label class="fld"><span>Testimonial</span><textarea data-f="text" rows="4" maxlength="600">${esc(s.message)}</textarea></label>
        <div class="story-actions"><button type="button" class="btn danger sm" data-do="delete">Delete</button><button type="button" class="btn primary sm" data-do="publish">Publish</button></div>
      </article>`).join('') : '<p class="muted">No testimonials waiting. New ones appear here when visitors send them.</p>';
  } else {
    list.innerHTML = published.length ? published.map((s, i) => `<article class="card story" data-i="${i}">
        <blockquote>${esc(s.text)}</blockquote>
        <div class="story-meta"><b>${esc(s.name)}</b><span>${esc(s.detail || '')}</span></div>
        <div class="story-actions">
          <button type="button" class="btn sm" data-do="up" ${i === 0 ? 'disabled' : ''}>Move up</button>
          <button type="button" class="btn sm" data-do="down" ${i === published.length - 1 ? 'disabled' : ''}>Move down</button>
          <button type="button" class="btn danger sm" data-do="unpublish">Remove from site</button>
        </div>
      </article>`).join('') : '<p class="muted">Nothing published yet.</p>';
  }
  body.querySelectorAll('[data-st]').forEach(b => { b.onclick = () => { ui.storyTab = b.dataset.st; drawStories(); }; });
  document.getElementById('refreshStories').onclick = async () => { await loadStories(); drawTab(); };
  list.querySelectorAll('[data-do]').forEach(b => { b.onclick = () => storyAction(b).catch(e => alert('That did not work: ' + (e.message || e))); });
}

async function storyAction(btn) {
  const card = btn.closest('.story');
  const act = btn.dataset.do;
  btn.disabled = true;
  if (act === 'publish' || act === 'delete') {
    const s = data.pending.find(p => p.id === card.dataset.id);
    if (act === 'delete') {
      if (!confirm('Delete this testimonial? This cannot be undone.')) { btn.disabled = false; return; }
      await api.remove(s.id);
    } else {
      const val = f => card.querySelector(`[data-f="${f}"]`).value.trim();
      if (!val('name') || !val('text')) { alert('The name and the testimonial cannot be empty.'); btn.disabled = false; return; }
      const item = { id: s.id, name: val('name'), detail: val('detail'), text: val('text'), at: Date.now() };
      await api.savePublished([item].concat(data.published.filter(p => p.id !== s.id)));
      await api.setStatus(s.id, 'approved');
    }
  } else {
    const i = +card.dataset.i, items = data.published.slice();
    if (act === 'unpublish') {
      if (!confirm('Remove this testimonial from the site?')) { btn.disabled = false; return; }
      const [gone] = items.splice(i, 1);
      await api.savePublished(items);
      await api.setStatus(gone.id, 'hidden');
    } else {
      const j = act === 'up' ? i - 1 : i + 1;
      [items[i], items[j]] = [items[j], items[i]];
      await api.savePublished(items);
    }
  }
  await loadStories();
  drawTab();
}

/* ---------- start ---------- */
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (ui.tab === 'overview' && data.stats) drawOverview(); }, 150);
});

async function main() {
  if (!DEMO && !(cfg.apiKey && cfg.projectId)) {
    message('Firebase is not set up yet', `<p>Fill in <code>firebase-config.js</code> with your Firebase project's web app settings, then reload this page.
      The steps are in the README under "One-time Firebase setup".</p><p><a href="?demo=1">Preview the admin panel with sample data</a></p>`);
    return;
  }
  try {
    api = DEMO ? demoBackend() : await firebaseBackend();
  } catch (e) {
    message('Could not load Firebase', `<p class="form-error">${esc(e.message || e)}</p>`);
    return;
  }
  api.onUser(async user => {
    if (!user) { signInScreen(); return; }
    showUser(user);
    root.innerHTML = '<p class="muted">Checking access…</p>';
    try {
      if (!(await api.isAdmin())) { notAdminScreen(user); return; }
      await panel();
    } catch (e) {
      message('Something went wrong', `<p class="form-error">${esc(explainError(e))}</p>`);
    }
  });
}

main();
