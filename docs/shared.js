// Certior: what every screen shares. Constants, storage, usage counts, helpers, and S, the state that more than one
// module changes (a module can read another's variables but not assign them).
// Each field of S is set where the old `let` was, so values start in the same order as before.
export const S = {};

export const params = new URLSearchParams(location.search);
// ponytail: copied from the certior-news repo's docs/; Actions publishes the feed to GitHub Pages, so new stories need no Render deploy
export const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);   // ?feed= and ?debug are for testing: on the live site a link must not be able to swap the feed or load a script
export const FEED_URL = (LOCAL && params.get('feed')) || 'feed.json';
export const TOPICS = { all: 'All News', politics: 'Politics', business: 'Business', tech: 'Tech', science: 'Science & Health', crime: 'Crime', disasters: 'Disasters', culture: 'Culture', sports: 'Sports' };
export const REGION_LABEL = { americas: 'Americas', asia: 'Asia and Pacific', europe: 'Europe', mideast_africa: 'Africa and Middle East' };
export const COUNTRY = {
  US: ['United States', '\u{1F1FA}\u{1F1F8}'], UK: ['United Kingdom', '\u{1F1EC}\u{1F1E7}'], India: ['India', '\u{1F1EE}\u{1F1F3}'], Qatar: ['Qatar', '\u{1F1F6}\u{1F1E6}'],
  'Saudi Arabia': ['Saudi Arabia', '\u{1F1F8}\u{1F1E6}'], Australia: ['Australia', '\u{1F1E6}\u{1F1FA}'], Turkey: ['Turkey', '\u{1F1F9}\u{1F1F7}'], France: ['France', '\u{1F1EB}\u{1F1F7}'],
  'South Africa': ['South Africa', '\u{1F1FF}\u{1F1E6}'], Singapore: ['Singapore', '\u{1F1F8}\u{1F1EC}'], 'South Korea': ['South Korea', '\u{1F1F0}\u{1F1F7}'], Venezuela: ['Venezuela', '\u{1F1FB}\u{1F1EA}'],
  'Pan-African': ['Pan-African', '\u{1F30D}'], Kenya: ['Kenya', '\u{1F1F0}\u{1F1EA}'], Nigeria: ['Nigeria', '\u{1F1F3}\u{1F1EC}'], Germany: ['Germany', '\u{1F1E9}\u{1F1EA}'],
  Canada: ['Canada', '\u{1F1E8}\u{1F1E6}'], 'Hong Kong': ['Hong Kong', '\u{1F1ED}\u{1F1F0}'], Israel: ['Israel', '\u{1F1EE}\u{1F1F1}'], Japan: ['Japan', '\u{1F1EF}\u{1F1F5}'],
};
export const SOMEWHERE_MIN = 5;      // "Take Me Somewhere" skips countries with too little to show
export const RECENT_MAX = 6;
export const MIX_DAYS = 7;
export const COLUMNS = { left: 'Left', center: 'Center', right: 'Right', state: 'State-funded', unrated: 'Not rated' };
export const SIDES = ['left', 'center', 'right'];      // the pipeline orders clips Left, Center, Right, Left..., then the rest
// The outlet's own rating. Lean Left swipes under Left and Lean Right under Right, so this tells them apart.
export const LEAN = { left: 'Left', 'lean-left': 'Lean Left', center: 'Center', 'lean-right': 'Lean Right', right: 'Right', unrated: 'Not rated' };
// After the outlet: "Lean Left · 3h ago · Canada". On a narrow phone with videos on the row runs out of room, so the
// country, which the Compare sheet and World tab also show, comes last. Sport has no sides, so no rating.
// The clip row leaves the country out (it cut off as "5h ago…", and World has it); Compare has room for it.
export const byline = (c, s, country = false) => [s.topic !== 'sports' && (c.column === 'state' ? 'State-funded' : LEAN[c.lean]), ago(c.published), country && c.country].filter(Boolean).join(' · ');
export const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 500px)');   // a sideways phone, or any screen too short for the video: see #rotate
export const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
export const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/>${path}</svg>`;
export const SOUND_ON = icon('<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
export const SOUND_OFF = icon('<path d="m16 9.5 5 5m0-5-5 5"/>');
export const PLAY_CHECK_MS = 1800;   // if a clip isn't playing after this, ask for a tap
export const WATCHED_AFTER_MS = 3000;
export const DOUBLE_TAP_MS = 250, SKIP_S = 10;
// Swipes over the video follow your finger: past DRAG_COMMIT of the screen, or a flick faster than FLICK_PX_MS, goes on
// to the next story or outlet when you let go; anything less springs back. DRAG_START tells a drag from a tap.
export const DRAG_START = 8, DRAG_COMMIT = 0.25, FLICK_PX_MS = 0.4;
export const SIDEWAYS_HINT = 'Swipe sideways for more outlets, or slide along the dots';
export const SETTINGS_DEFAULTS = { side: 'center', hideWatched: false, sportsInAll: true, notes: true };
// YouTube forbids disabling the links inside its player, and they sit along its top and bottom edges.
// So swipes are only caught in the middle band; everything above and below reaches YouTube.
export const GESTURE_TOP = 0.25, GESTURE_HEIGHT = 0.5;
export const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/></svg>';
export const MORE_AT = 8, MORE_STORIES = 40;      // the feed is the top stories only: fetch the rest when you get this close to its end
export const FLASH_MS = 3000;      // every message and tip goes after this, so it never sits on the video
export const SHUFFLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.500 7.500h3.300c1.500 0 2.800.7 3.700 1.900l3 4.200c.9 1.200 2.200 1.900 3.700 1.900h3.300M3.500 16.500h3.300c1.500 0 2.800-.7 3.700-1.900M14.500 10.400c.9-1.200 1.200-2.900 3.700-2.900h2.300M18 5l2.500 2.500L18 10M18 14l2.500 2.500L18 19"/></svg>';
export const CHECK_FEED_MS = 2 * 60000;
export const AWAY_MS = 60 * 60000, RECAP_NEW_MAX = 10, RECAP_MIN_OUTLETS = 3;     // Recap: away this long and the stories that began since get a badge

export const $ = (s, el = document) => el.querySelector(s);
export const feedEl = $('#feed'), wrap = $('#player-wrap'), gesture = $('#gesture');
export const hintEl = $('#hint'), statusEl = $('#status');
export const welcomeEl = $('#welcome'), compareEl = $('#compare');
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (LOCAL && params.has('debug')) {   // on-screen console for testing on a phone (reach the dev server through a tunnel to localhost)
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/eruda'; s.onload = () => window.eruda.init();
  document.head.appendChild(s);
}

// ---------------------------------------------------------------- storage (never throws)
export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};
for (const old of ['blind', 'dailyGame']) { try { localStorage.removeItem(old); } catch { /* private mode etc. */ } }     // from a game that no longer exists
export const settings = { ...SETTINGS_DEFAULTS, ...store.get('settings', {}) };
if (!settings.side) settings.side = 'center';     // '' was the old default, Last Side I Picked: it left everyone on Left
S.consent = store.get('consent', null);    // 'videos' or 'text'. Nothing from YouTube loads until it is 'videos'.
export const videosOn = () => S.consent === 'videos';
document.documentElement.classList.toggle('videos', videosOn());     // style.css gives the video more room
S.watched = new Set(store.get('watched', []));
export const storiesCounted = new Map();      // this visit: story id -> what was counted for it ({ watched, compared })
export function markWatched(id) {
  if (S.watched.has(id)) return;
  S.watched.add(id);
  store.set('watched', [...S.watched].slice(-3000));
  const s = S.stories[S.activeS], clip = s?.clips.find((c) => c.id === id);
  if (clip && clip.column !== 'unrated') recordMix(clip.column);
  if (clip) count(`watched_${clip.column}`);
  // of the stories offering two or more sides: one you watched a clip of, and one you've now watched from two or more
  // (on this visit or with clips from earlier ones), once each a visit: the stats page's measure of what Certior is for
  const offered = new Set(s?.clips.filter((k) => k.column !== 'unrated').map((k) => k.column));
  if (clip && clip.column !== 'unrated' && offered.size >= 2) {
    const done = storiesCounted.get(s.id) || {};
    storiesCounted.set(s.id, done);
    if (!done.watched) { done.watched = true; count('story_watched'); }
    const sides = new Set(s.clips.filter((k) => k.column !== 'unrated' && S.watched.has(k.id)).map((k) => k.column));
    if (sides.size >= 2 && !done.compared) { done.compared = true; count('story_compared'); }
  }
}

// ---------------------------------------------------------------- your mix: on this device only, never a reward
export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// ---------------------------------------------------------------- usage counts
// Anonymous daily totals for the stats page: only counts like { visit: 1, watched_left: 3 }, no cookies, IDs or
// addresses (see Privacy). Sent as one small batch when you leave the app. Where there's no endpoint (GitHub Pages,
// a local copy) the send just fails.
export const STATS_URL = '/api/certior/events';
export const tally = {};
export const count = (name, n = 1) => { tally[name] = (tally[name] || 0) + n; };
export function sendCounts() {
  if (!Object.keys(tally).length || store.get('owner', false)) return;      // the stats page marks its own browser: the owner's visits aren't usage
  try { navigator.sendBeacon?.(STATS_URL, new Blob([JSON.stringify(tally)], { type: 'application/json' })); } catch { /* no beacon: skip */ }
  for (const k of Object.keys(tally)) delete tally[k];
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendCounts(); });
window.addEventListener('pagehide', sendCounts);
// Once per device per day: a visit, how long ago this device first came (retention), Home Screen or browser, and
// where it came from (?ref= on links you post, else the referring site).
export function countVisit() {
  const today = dayKey();
  if (store.get('countedDay', null) === today) return;
  store.set('countedDay', today);
  let first = store.get('firstDay', null);
  if (!first) { first = today; store.set('firstDay', today); count('new'); }
  const age = Math.round((Date.parse(today) - Date.parse(first)) / 864e5);
  count('visit');
  count(`age_${age === 0 ? '0' : age === 1 ? '1' : age <= 7 ? '2_7' : age <= 30 ? '8_30' : '31_plus'}`);
  count(matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'homescreen' : 'browser');
  if (S.consent) count(`mode_${S.consent}`);
  let ref = new URLSearchParams(location.search).get('ref') || '';
  try { if (!ref && document.referrer && new URL(document.referrer).host !== location.host) ref = new URL(document.referrer).host; } catch { /* no referrer */ }
  ref = ref.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '').slice(0, 40);
  if (ref) count(`ref:${ref}`);
}
export function recordMix(column) {
  const cutoff = dayKey(Date.now() - MIX_DAYS * 864e5);
  const mix = Object.fromEntries(Object.entries(store.get('mix', {})).filter(([day]) => day > cutoff));
  const today = (mix[dayKey()] = mix[dayKey()] || {});
  today[column] = (today[column] || 0) + 1;
  store.set('mix', mix);
}
export function renderMix(box) {
  box.textContent = '';
  const cutoff = dayKey(Date.now() - MIX_DAYS * 864e5);
  const totals = { left: 0, center: 0, right: 0 };
  for (const [day, counts] of Object.entries(store.get('mix', {}))) {
    if (day > cutoff) for (const k of Object.keys(totals)) totals[k] += counts[k] || 0;
  }
  const sum = totals.left + totals.center + totals.right;
  if (!sum) {
    box.append(el('p', '', 'Nothing yet. Watch a few clips to see your week.'));
    return;
  }
  for (const [k, n] of Object.entries(totals)) {
    const row = el('div', 'mix-row');
    row.dataset.column = k;
    const bar = el('span', 'mix-bar');
    const fill = el('i');
    fill.style.width = `${Math.round((n / sum) * 100)}%`;
    bar.append(fill);
    row.append(el('span', 'mix-name', COLUMNS[k]), bar, el('span', 'mix-n', String(n)));
    box.append(row);
  }
  const least = Object.keys(totals).reduce((a, b) => (totals[b] < totals[a] ? b : a));
  if (sum >= 5 && settings.side !== least) {
    const b = el('button', 'mix-try', `Open Stories on ${COLUMNS[least]} for a While`);
    b.onclick = () => {
      settings.side = least;
      store.set('settings', settings);
      $('#set-side').value = least;
      b.replaceWith(el('p', '', `Stories will open on ${COLUMNS[least]} when they have it.`));
    };
    box.append(b);
  }
}

// ---------------------------------------------------------------- state
S.feed = null, S.stories = [];
S.activeS = -1, S.activeC = -1, S.currentId = null;
S.player = null, S.playerReady = false, S.unlocked = false, S.playing = false, S.playerStarted = false;
S.topic = TOPICS[store.get('topic', 'all')] ? store.get('topic', 'all') : 'all';
S.query = '', S.place = '', S.everything = null, S.searchFrom = 'search';     // searchFrom: the tab Back returns to
S.pushedList = null, S.feedSpot = null;     // pushedList: { title, stories } opened from Recap; feedSpot: your place in the feed before any of these
export const pushed = () => !!(S.place || S.query || S.pushedList);
// Before opening World, Search or a Recap list over the feed, remember your place; Back puts you there again.
export function leaveFeed() { if (!pushed()) S.feedSpot = here(); }
export function backToFeed() { S.place = ''; S.query = ''; S.pushedList = null; const at = S.feedSpot; S.feedSpot = null; return at; }
S.tab = 'news', S.pageOpen = false, S.lastPlace = '';   // pageOpen: a full page covers the feed, so the player stays out of the way
S.reserve = null, S.loadingMore = false, S.ended = false, S.startRun = 0, S.flashTimer = 0, S.refreshing = false;
S.side = null, S.autoAdvance = false;    // side: the one you last swiped to, for Open Stories On: Last Side I Picked
export const openSide = () => (settings.side === 'last' ? S.side || 'center' : settings.side);
S.playCheck = 0, S.watchTimer = 0;
S.latest = null;      // the newest feed fetched, even while you're still watching the one before it

// ---------------------------------------------------------------- helpers
export function ago(iso) {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
export function showHint(text) { hintEl.textContent = text; hintEl.hidden = !text; }
export function setStatus(text, retry) {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  if (retry) { const b = el('button', '', 'Try again'); b.onclick = () => location.reload(); statusEl.append(el('br'), b); }
}

// Where you are, by id, so a rebuilt feed can put you back on the same clip.
export const here = () => (S.stories[S.activeS] ? { story: S.stories[S.activeS].id, clip: S.stories[S.activeS].clips[S.activeC]?.id } : null);
