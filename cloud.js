// Connects the reviewer to Firebase: approved testimonials, the testimonial form, anonymous daily
// usage counters (shown in admin.html) and Google Analytics. When firebase-config.js has no apiKey,
// or Firebase cannot load, the site works exactly the same without these extras.
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const cfg = window.FIREBASE_CONFIG || {};
const STORIES_KEY = 'ipq_stories';
const SEEN_KEY = 'ipq_seen';
const STORIES_TTL = 30 * 60 * 1000;
const FLUSH_MS = 3 * 60 * 1000;

function announce(api) {
  window.siteCloud = api;
  document.dispatchEvent(new CustomEvent('cloud:ready'));
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage blocked */ }
  return null;
}

// Dates and hours in Philippine time, so a day's numbers match the local day.
const phDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const phHour = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', hourCycle: 'h23' }).format(new Date());

function referrerBucket() {
  let host = '';
  try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { host = ''; }
  if (!host || host === location.hostname) return 'refDirect';
  if (/(^|\.)(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex)\./.test(host)) return 'refSearch';
  if (/(facebook|fb\.|messenger|m\.me|instagram|tiktok|twitter|x\.com|t\.co|reddit|discord|linkedin|youtube|threads)/.test(host)) return 'refSocial';
  return 'refOther';
}

async function start() {
  const [{ initializeApp }, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-firestore-lite.js')
  ]);
  const app = initializeApp(cfg);
  const db = fs.getFirestore(app);

  // ---- Google Analytics (traffic, countries, devices, pages): Firebase console > Analytics ----
  let ga = null;
  let logEvent = null;
  if (cfg.measurementId) {
    import(SDK + 'firebase-analytics.js').then(async m => {
      if (!(await m.isSupported())) return;
      ga = m.initializeAnalytics(app, { config: { send_page_view: false } });
      logEvent = m.logEvent;
      flushGa();
    }).catch(() => {});
  }
  const gaQueue = [];
  function gaEvent(name, params) {
    if (ga) logEvent(ga, name, params); else if (gaQueue.length < 50) gaQueue.push([name, params]);
  }
  function flushGa() {
    while (gaQueue.length) { const [n, p] = gaQueue.shift(); logEvent(ga, n, p); }
  }

  // ---- anonymous daily counters, batched to stay well inside the free write quota ----
  let pending = {};
  function add(field, n = 1) { pending[field] = (pending[field] || 0) + n; }
  function addTo(map, key, n = 1) {
    pending[map] = pending[map] || {};
    pending[map][key] = (pending[map][key] || 0) + n;
  }
  function flush() {
    if (!Object.keys(pending).length) return;
    const payload = {};
    Object.keys(pending).forEach(k => {
      if (typeof pending[k] === 'number') payload[k] = fs.increment(pending[k]);
      else {
        payload[k] = {};
        Object.keys(pending[k]).forEach(sub => { payload[k][sub] = fs.increment(pending[k][sub]); });
      }
    });
    pending = {};
    fs.setDoc(fs.doc(db, 'stats', phDay()), payload, { merge: true }).catch(() => { /* quota reached or offline */ });
  }

  // this visit
  const day = phDay();
  const seen = store(SEEN_KEY) || {};
  add('visits');
  if (seen.day !== day) add('visitors');
  if (!seen.first) add('newVisitors');
  store(SEEN_KEY, { first: seen.first || day, day });
  add(window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820 ? 'mobile' : 'desktop');
  add(referrerBucket());
  addTo('h', phHour());
  flush();
  setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  const COUNT = { mock: 'mocks', lesson: 'lessons', flashcard: 'flashcards' };
  const GA_NAME = { mock: 'submit_mock_exam', lesson: 'open_lesson', exam: 'start_exam', deck: 'study_flashcards' };

  announce({
    // Records something a visitor did. view = a page change; answer = a question answered.
    track(event, params = {}) {
      if (event === 'view') {
        gaEvent('page_view', { page_title: document.title, page_location: location.href, page_path: location.pathname + (location.hash || '#/') });
        return;
      }
      if (event === 'answer') {
        add('answers');
        if (params.correct) add('correct');
        if (params.exam) addTo('ex', params.exam);
        return;
      }
      if (COUNT[event]) add(COUNT[event]);
      if (GA_NAME[event]) gaEvent(GA_NAME[event], params);
    },

    // Approved testimonials, cached for a while so most visits cost no database read.
    async stories() {
      const cached = store(STORIES_KEY);
      if (cached && Date.now() - cached.at < STORIES_TTL && Array.isArray(cached.items)) return cached.items;
      try {
        const snap = await fs.getDoc(fs.doc(db, 'public', 'testimonials'));
        const items = snap.exists() && Array.isArray(snap.data().items) ? snap.data().items : [];
        store(STORIES_KEY, { at: Date.now(), items });
        return items;
      } catch (e) {
        return cached && Array.isArray(cached.items) ? cached.items : [];
      }
    },

    // Sends a testimonial for review. It is only shown after an admin approves it.
    // Optional ratings (1-5 per aspect) stay private: they are saved with the story and added to the
    // day's totals, so the admin panel can show averages even after a story is deleted.
    async submitStory(story) {
      const ratings = story.ratings || {};
      const doc = {
        name: story.name, exam: story.exam, result: story.result, message: story.message,
        status: 'pending', createdAt: fs.serverTimestamp()
      };
      if (Object.keys(ratings).length) doc.ratings = ratings;
      await fs.addDoc(fs.collection(db, 'submissions'), doc);
      add('stories');
      Object.keys(ratings).forEach(k => { addTo('rt', k + 'Sum', ratings[k]); addTo('rt', k + 'Count'); });
      flush();
      gaEvent('submit_testimonial', {});
    }
  });
}

if (cfg.apiKey && cfg.projectId) {
  start().catch(err => {
    console.warn('Firebase features are off:', err);
    announce(null);
  });
} else {
  announce(null);
}
