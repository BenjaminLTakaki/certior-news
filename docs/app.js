// Certior (built in the swipe-news repo) — one story per screen. Swipe up/down = next/previous story,
// swipe left/right = the same story from another outlet.
// One YouTube player is reused for every clip and laid over the active clip's video area.

import { storyCard } from './card.js';

const params = new URLSearchParams(location.search);
const FEED_URL = params.get('feed') || 'feed.json';
const TOPICS = { all: 'All News', politics: 'Politics', business: 'Business', tech: 'Tech', science: 'Science & Health', crime: 'Crime', disasters: 'Disasters', culture: 'Culture', sports: 'Sports' };
const REGION_LABEL = { americas: 'Americas', asia: 'Asia and Pacific', europe: 'Europe', mideast_africa: 'Africa and Middle East' };
const COUNTRY = {
  US: ['United States', '\u{1F1FA}\u{1F1F8}'], UK: ['United Kingdom', '\u{1F1EC}\u{1F1E7}'], India: ['India', '\u{1F1EE}\u{1F1F3}'], Qatar: ['Qatar', '\u{1F1F6}\u{1F1E6}'],
  'Saudi Arabia': ['Saudi Arabia', '\u{1F1F8}\u{1F1E6}'], Australia: ['Australia', '\u{1F1E6}\u{1F1FA}'], Turkey: ['Turkey', '\u{1F1F9}\u{1F1F7}'], France: ['France', '\u{1F1EB}\u{1F1F7}'],
  'South Africa': ['South Africa', '\u{1F1FF}\u{1F1E6}'], Singapore: ['Singapore', '\u{1F1F8}\u{1F1EC}'], 'South Korea': ['South Korea', '\u{1F1F0}\u{1F1F7}'], Venezuela: ['Venezuela', '\u{1F1FB}\u{1F1EA}'],
  'Pan-African': ['Pan-African', '\u{1F30D}'], Kenya: ['Kenya', '\u{1F1F0}\u{1F1EA}'], Nigeria: ['Nigeria', '\u{1F1F3}\u{1F1EC}'], Germany: ['Germany', '\u{1F1E9}\u{1F1EA}'],
  Canada: ['Canada', '\u{1F1E8}\u{1F1E6}'], 'Hong Kong': ['Hong Kong', '\u{1F1ED}\u{1F1F0}'], Israel: ['Israel', '\u{1F1EE}\u{1F1F1}'], Japan: ['Japan', '\u{1F1EF}\u{1F1F5}'],
};
const SOMEWHERE_MIN = 5;      // "Take Me Somewhere" skips countries with too little to show
const RECENT_MAX = 6;
const MIX_DAYS = 7;
const COLUMNS = { left: 'Left', center: 'Center', right: 'Right', state: 'State-funded', unrated: 'Not rated' };
const SIDES = ['left', 'center', 'right'];      // the pipeline orders clips Left, Center, Right, Left..., then the rest
// The outlet's own rating. Lean Left swipes under Left and Lean Right under Right, so this tells them apart.
const LEAN = { left: 'Left', 'lean-left': 'Lean Left', center: 'Center', 'lean-right': 'Lean Right', right: 'Right', unrated: 'Not rated' };
// After the outlet: "Lean Left · 3h ago · Canada". On a narrow phone with videos on the row runs out of room, so the
// country, which the Compare sheet and World tab also show, comes last. Sport has no sides, so no rating.
// The clip row leaves the country out (it cut off as "5h ago…", and World has it); Compare has room for it.
const byline = (c, s, country = false) => [s.topic !== 'sports' && (c.column === 'state' ? 'State-funded' : LEAN[c.lean]), ago(c.published), country && c.country].filter(Boolean).join(' · ');
const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 500px)');   // a sideways phone, or any screen too short for the video: see #rotate
const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/>${path}</svg>`;
const SOUND_ON = icon('<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
const SOUND_OFF = icon('<path d="m16 9.5 5 5m0-5-5 5"/>');
const PLAY_CHECK_MS = 1800;   // if a clip isn't playing after this, ask for a tap
const WATCHED_AFTER_MS = 3000;
const DOUBLE_TAP_MS = 250, SKIP_S = 10;
// Swipes over the video follow your finger: past DRAG_COMMIT of the screen, or a flick faster than FLICK_PX_MS, goes on
// to the next story or outlet when you let go; anything less springs back. DRAG_START tells a drag from a tap.
const DRAG_START = 8, DRAG_COMMIT = 0.25, FLICK_PX_MS = 0.4;
const SIDEWAYS_HINT = 'Swipe sideways for more outlets, or slide along the dots';
const SETTINGS_DEFAULTS = { side: 'center', hideWatched: false, sportsInAll: true, notes: true };
// YouTube forbids disabling the links inside its player, and they sit along its top and bottom edges.
// So swipes are only caught in the middle band; everything above and below reaches YouTube.
const GESTURE_TOP = 0.25, GESTURE_HEIGHT = 0.5;
const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/></svg>';
const MORE_AT = 8, MORE_STORIES = 40;      // the feed is the top stories only: fetch the rest when you get this close to its end
const FLASH_MS = 3000;      // every message and tip goes after this, so it never sits on the video
const SHUFFLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.500 7.500h3.300c1.500 0 2.800.7 3.700 1.900l3 4.200c.9 1.200 2.200 1.900 3.700 1.900h3.300M3.500 16.500h3.300c1.500 0 2.800-.7 3.700-1.900M14.500 10.400c.9-1.200 1.200-2.900 3.700-2.900h2.300M18 5l2.500 2.500L18 10M18 14l2.500 2.500L18 19"/></svg>';
const CHECK_FEED_MS = 2 * 60000;
const AWAY_MS = 60 * 60000, RECAP_NEW_MAX = 10, RECAP_MIN_OUTLETS = 3;     // Recap: away this long and the stories that began since get a badge

const $ = (s, el = document) => el.querySelector(s);
const feedEl = $('#feed'), wrap = $('#player-wrap'), gesture = $('#gesture');
const hintEl = $('#hint'), statusEl = $('#status');
const welcomeEl = $('#welcome'), compareEl = $('#compare');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (params.has('debug')) {   // on-screen console for testing on the iPhone without a Mac
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/eruda'; s.onload = () => window.eruda.init();
  document.head.appendChild(s);
}

// ---------------------------------------------------------------- storage (never throws)
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};
for (const old of ['blind', 'dailyGame']) { try { localStorage.removeItem(old); } catch { /* private mode etc. */ } }     // from a game that no longer exists
const settings = { ...SETTINGS_DEFAULTS, ...store.get('settings', {}) };
if (!settings.side) settings.side = 'center';     // '' was the old default, Last Side I Picked: it left everyone on Left
let consent = store.get('consent', null);    // 'videos' or 'text'. Nothing from YouTube loads until it is 'videos'.
const videosOn = () => consent === 'videos';
document.documentElement.classList.toggle('videos', videosOn());     // style.css gives the video more room
let watched = new Set(store.get('watched', []));
function markWatched(id) {
  if (watched.has(id)) return;
  watched.add(id);
  store.set('watched', [...watched].slice(-3000));
  const clip = stories[activeS]?.clips.find((c) => c.id === id);
  if (clip && clip.column !== 'unrated') recordMix(clip.column);
  if (clip) count(`watched_${clip.column}`);
}

// ---------------------------------------------------------------- your mix: on this device only, never a reward
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// ---------------------------------------------------------------- usage counts
// Anonymous daily totals for the stats page: only counts like { visit: 1, watched_left: 3 }, no cookies, IDs or
// addresses (see Privacy). Sent as one small batch when you leave the app. Where there's no endpoint (GitHub Pages,
// a local copy) the send just fails.
const STATS_URL = '/api/swipe-news/events';
const tally = {};
const count = (name, n = 1) => { tally[name] = (tally[name] || 0) + n; };
function sendCounts() {
  if (!Object.keys(tally).length) return;
  try { navigator.sendBeacon?.(STATS_URL, new Blob([JSON.stringify(tally)], { type: 'application/json' })); } catch { /* no beacon: skip */ }
  for (const k of Object.keys(tally)) delete tally[k];
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendCounts(); });
window.addEventListener('pagehide', sendCounts);
// Once per device per day: a visit, how long ago this device first came (retention), Home Screen or browser, and
// where it came from (?ref= on links you post, else the referring site).
function countVisit() {
  const today = dayKey();
  if (store.get('countedDay', null) === today) return;
  store.set('countedDay', today);
  let first = store.get('firstDay', null);
  if (!first) { first = today; store.set('firstDay', today); count('new'); }
  const age = Math.round((Date.parse(today) - Date.parse(first)) / 864e5);
  count('visit');
  count(`age_${age === 0 ? '0' : age === 1 ? '1' : age <= 7 ? '2_7' : age <= 30 ? '8_30' : '31_plus'}`);
  count(matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'homescreen' : 'browser');
  if (consent) count(`mode_${consent}`);
  let ref = new URLSearchParams(location.search).get('ref') || '';
  try { if (!ref && document.referrer && new URL(document.referrer).host !== location.host) ref = new URL(document.referrer).host; } catch { /* no referrer */ }
  ref = ref.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '').slice(0, 40);
  if (ref) count(`ref:${ref}`);
}
function recordMix(column) {
  const cutoff = dayKey(Date.now() - MIX_DAYS * 864e5);
  const mix = Object.fromEntries(Object.entries(store.get('mix', {})).filter(([day]) => day > cutoff));
  const today = (mix[dayKey()] = mix[dayKey()] || {});
  today[column] = (today[column] || 0) + 1;
  store.set('mix', mix);
}
function renderMix(box) {
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
let feed = null, stories = [];
let activeS = -1, activeC = -1, currentId = null;
let player = null, playerReady = false, unlocked = false, playing = false, playerStarted = false;
let topic = TOPICS[store.get('topic', 'all')] ? store.get('topic', 'all') : 'all';
let query = '', place = '', everything = null, searchFrom = 'search';     // searchFrom: the tab Back returns to
let pushedList = null, feedSpot = null;     // pushedList: { title, stories } opened from Recap; feedSpot: your place in the feed before any of these
const pushed = () => !!(place || query || pushedList);
// Before opening World, Search or a Recap list over the feed, remember your place; Back puts you there again.
function leaveFeed() { if (!pushed()) feedSpot = here(); }
function backToFeed() { place = ''; query = ''; pushedList = null; const at = feedSpot; feedSpot = null; return at; }
let tab = 'news', pageOpen = false, lastPlace = '';   // pageOpen: a full page covers the feed, so the player stays out of the way
let reserve = null, loadingMore = false, ended = false, startRun = 0, flashTimer = 0, refreshing = false;
let side = null, autoAdvance = false;    // side: the one you last swiped to, for Open Stories On: Last Side I Picked
const openSide = () => (settings.side === 'last' ? side || 'center' : settings.side);
let playCheck = 0, watchTimer = 0;
let latest = null;      // the newest feed fetched, even while you're still watching the one before it

// ---------------------------------------------------------------- helpers
function ago(iso) {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function showHint(text) { hintEl.textContent = text; hintEl.hidden = !text; }
function setStatus(text, retry) {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  if (retry) { const b = el('button', '', 'Try again'); b.onclick = () => location.reload(); statusEl.append(el('br'), b); }
}

// ---------------------------------------------------------------- feed
const FEED_TIMEOUT_MS = 15000, NEWER_CHECK_MS = 6000;
async function loadFeed() {
  // a request that never answers would leave "Loading stories…" up for good: give up, and offer Try Again
  const r = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout?.(FEED_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`feed ${r.status}`);
  const f = await r.json();
  bySide(f.stories);
  return f;
}

// Clips in the order of the dots: all of Left, then Center, then Right, then the rest. A swipe sideways is then the
// next outlet on the same side, and a change of side shows on the control up top. Within a side the feed's order
// stays (the take least like the others first).
// ponytail: the pipeline still interleaves L, C, R (swipe_order); sorting here needs no feed rebuild
const SIDE_RANK = { left: 0, center: 1, right: 2, state: 3 };
function bySide(list) {
  for (const s of list) if (s.topic !== 'sports') s.clips.sort((a, b) => (SIDE_RANK[a.column] ?? 4) - (SIDE_RANK[b.column] ?? 4));
  return list;
}

const inFeedView = () => !pageOpen;

function renderBar() {
  const back = $('#back'), action = $('#bar-action'), select = $('#topic'), isPushed = pushed();
  back.hidden = !isPushed;
  back.textContent = place ? 'World' : searchFrom === 'recap' ? 'Recap' : 'Search';
  select.hidden = isPushed;
  $('#bar-chevron').toggleAttribute('hidden', isPushed);      // an svg has no .hidden property
  $('#bar-title').textContent = place ? `${COUNTRY[place]?.[1] ?? ''} ${COUNTRY[place]?.[0] ?? place}`.trim()
    : query ? `\u201C${query}\u201D` : pushedList ? pushedList.title : TOPICS[topic];
  select.value = topic;
  action.innerHTML = place ? SHUFFLE_ICON : REFRESH_ICON;
  action.setAttribute('aria-label', place ? 'Take me somewhere else' : newWaiting ? 'Show new stories' : 'Check for new stories');
  action.classList.toggle('new', newWaiting && !place);
  action.onclick = place ? takeMeSomewhere : refreshFeed;
  if (isPushed) $('#bar-end').prepend(action); else $('#bar-start').append(action);
}

$('#topic').append(...Object.entries(TOPICS).map(([key, label]) => { const o = el('option', '', label); o.value = key; return o; }));
$('#topic').onchange = (e) => {
  topic = e.target.value;
  store.set('topic', topic);
  renderBar();
  if (feed) { onScrollStart(); start(); }
};
$('#back').onclick = () => {
  const from = place ? 'world' : searchFrom;
  const at = backToFeed();
  renderBar();
  onScrollStart();
  pageOpen = true;      // the page comes back first, so nothing plays behind it while the feed rebuilds
  if (feed) start(at);
  show(from);
};

// ---------------------------------------------------------------- tabs
function show(next, opts = {}) {
  tab = next;
  pageOpen = next !== 'news' && !opts.pushed;
  for (const b of document.querySelectorAll('#tabbar button')) {
    const on = b.dataset.tab === next;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const name of ['recap', 'world', 'search', 'settings']) $(`#page-${name}`).hidden = !(pageOpen && name === next);
  if (pageOpen) {
    onScrollStart();
    showHint('');
    if (next === 'recap') renderRecap();
    if (next === 'world') renderWorld();
    if (next === 'search') {
      if ($('#search-input').value.trim()) showResults();      // back from a result: the list you left
      else { renderRecent(); $('#search-input').focus(); }      // inside the tap, so iOS opens the keyboard
    }
    if (next === 'settings') syncSettings();
    return;
  }
  if (settingsChanged && feed) {      // which stories you see may have changed
    settingsChanged = redraw = false;
    onScrollStart();
    start(here());
  } else if (redraw && feed) {        // only how they're drawn
    redraw = false;
    onScrollStart();
    draw(here());
  } else {
    settle();
  }
}
for (const b of document.querySelectorAll('#tabbar button')) {
  b.onclick = () => {
    const next = b.dataset.tab;
    if (next === 'news') {
      if (pushed()) {        // tapping a tab returns to its root, as everywhere on iOS
        const at = backToFeed();
        renderBar();
        pageOpen = false;
        onScrollStart();
        if (feed) start(at);
      } else if (tab === 'news') {
        feedEl.scrollTo({ top: 0, behavior: SMOOTH });
      }
      return show('news');
    }
    if (pushed()) {
      const at = backToFeed();
      renderBar();
      pageOpen = true;
      if (feed) start(at);
    }
    show(next);
  };
}

// ---------------------------------------------------------------- recap
// "Since your last visit" starts when you left the app, if you were gone at least AWAY_MS.
let since = 0, leftAt = store.get('lastSeen', 0), recapSeen = false;
function cameBack() {
  if (leftAt && Date.now() - leftAt >= AWAY_MS) { since = leftAt; recapSeen = false; }
  leftAt = 0;
}
cameBack();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { leftAt = Date.now(); store.set('lastSeen', leftAt); return; }
  cameBack();
  updateBadge();
});
window.addEventListener('pagehide', () => store.set('lastSeen', Date.now()));

const recapTopic = (s) => settings.sportsInAll || s.topic !== 'sports';
const newSince = (list) => (since ? list.filter((s) => !s.single && recapTopic(s) && Date.parse(s.first) > since) : []).slice(0, RECAP_NEW_MAX);
function updateBadge() {
  const n = recapSeen || !latest ? 0 : newSince(latest.stories).length, badge = $('#recap-badge');
  badge.hidden = !n;
  badge.textContent = n;
  $('#tabbar [data-tab="recap"]').setAttribute('aria-label', n ? `Recap, ${n} new ${n === 1 ? 'story' : 'stories'}` : 'Recap');
}

function dayLabel(day) {
  if (day === dayKey()) return 'Today';
  if (day === dayKey(Date.now() - 864e5)) return 'Yesterday';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// The first headline from each side, in swipe order: a story told by its sides, not by one outlet's summary.
const sideHeads = (s) => Object.fromEntries(SIDES.map((k) => [k, s.clips.find((c) => c.column === k)]).filter(([, c]) => c));

// A row opens the story over the feed while it's still in the last two days (Back returns here), and its clip on
// YouTube after that. open(live) gets the story the row stands for.
function recapRow(e, live, open, when) {
  const b = el(live ? 'button' : 'a', 'cell headline');
  b.append(el('span', 'headline-title', e.headline));
  for (const k of SIDES) {
    const h = e.by_side?.[k];
    if (!h) continue;
    const line = el('span', 'headline-sub side-line');
    line.dataset.column = k;
    line.append(el('b', '', `${COLUMNS[k]} \u00b7 ${h.channel}`), ` ${h.title}`);
    b.append(line);
  }
  b.append(el('span', 'headline-meta', [`${e.outlets} outlets`, when, !live && 'Watch on YouTube \u2197'].filter(Boolean).join(' \u00b7 ')));
  if (live) {
    b.type = 'button';
    b.onclick = () => open(live);
  } else {
    b.href = `https://www.youtube.com/watch?v=${e.clips[0]}`; b.target = '_blank'; b.rel = 'noopener';
  }
  return b;
}

async function renderRecap() {
  count('recap');
  recapSeen = true;
  updateBadge();
  const box = $('#recap-list'), src = latest || feed;
  if (!src) return;
  if (!everything) {
    box.textContent = '';
    box.append(el('p', 'group-note', 'Loading…'));
    everything = await loadEverything();
  }
  const byClip = new Map([...everything, ...src.stories].flatMap((s) => s.clips.map((c) => [c.id, s])));
  const find = (ids) => byClip.get(ids.find((id) => byClip.has(id)));
  const outlets = (s) => Object.values(s.coverage).reduce((a, b) => a + b, 0);
  box.textContent = '';
  const section = (title, rows) => {
    if (!rows.length) return;
    const group = el('div', 'group');
    group.append(...rows);
    box.append(el('h2', 'group-title', title), group);
  };
  // Each section opens as a list you can swipe through, starting at the story you tapped.
  const rows = (title, items) => {
    const live = items.map((x) => x.live).filter(Boolean);
    return items.map((x) => recapRow(x.e, x.live, (s) => openRecapList(title, live, s), x.when));
  };
  const fresh = newSince(src.stories).sort((a, b) => outlets(b) - outlets(a));
  section('Since Your Last Visit', rows('Since Your Last Visit', fresh.map((s) =>
    ({ e: { ...s, outlets: outlets(s), clips: s.clips.map((c) => c.id), by_side: sideHeads(s) }, live: s, when: `began ${ago(s.first)}` }))));
  const digest = (src.digest || []).filter((e) => recapTopic(e) && e.outlets >= RECAP_MIN_OUTLETS);
  for (const day of [...new Set(digest.map((e) => e.day))]) {
    const items = digest.filter((e) => e.day === day).sort((a, b) => b.outlets - a.outlets || b.score - a.score)
      .map((e) => ({ e, live: find(e.clips) }));
    section(dayLabel(day), rows(dayLabel(day), items));
  }
  renderFraming(box, src.framing);
  box.append(el('p', 'group-note', digest.length
    ? 'Each day\u2019s biggest stories: the ones the most outlets covered. Under each, the first headline from each side.'
    : 'Recap fills in as the day’s stories come in.'));
}

// Words one side used more than the other for the same stories this week; only differences too big to be chance.
function renderFraming(box, f) {
  if (!f?.headlines) return;
  const base = `${f.headlines} headlines from ${f.stories} stories both Left and Right covered this week`;
  if (!f.left.length && !f.right.length) return;      // nothing to show yet: an empty section read as broken
  for (const [side, label] of [['left', 'Left'], ['right', 'Right']]) {
    if (!f[side].length) continue;
    const group = el('div', 'group');
    for (const w of f[side]) {
      const row = el('button', 'cell nav');
      row.type = 'button';
      const tail = el('span', 'tail');
      tail.append(el('span', 'count', `${w.outlets} outlets`));
      row.append(el('span', '', w.word), tail);
      row.onclick = () => runSearch(w.word, 'recap');
      group.append(row);
    }
    box.append(el('h2', 'group-title', `Words ${label} Outlets Used More`), group);
  }
  box.append(el('p', 'group-note', `From ${base}, each outlet counted once per story. Only differences too big to be chance are shown. Tap a word to see its stories.`));
}

function openRecapList(title, list, s) {
  leaveFeed();
  place = ''; query = '';
  pushedList = { title, stories: list };
  searchFrom = 'recap';
  renderBar();
  onScrollStart();
  pageOpen = false;
  start({ story: s.id });
  show('recap', { pushed: true });
}

function openStory(s, clip) {
  place = ''; query = '';
  renderBar();
  onScrollStart();
  pageOpen = false;
  start({ story: s.id, clip }, s);
  show('news');
}

// ---------------------------------------------------------------- world
function countriesIn(list) {
  const found = new Map();
  for (const s of list) {
    if (s.topic === 'sports') continue;
    for (const c of new Set(s.clips.map((k) => k.country).filter(Boolean))) {
      const entry = found.get(c) || { country: c, region: s.clips.find((k) => k.country === c).region, stories: 0 };
      entry.stories++;
      found.set(c, entry);
    }
  }
  return [...found.values()];
}
// Stories only this country's outlets have come first: that's the point of going there.
function placeList(list, country) {
  const here = list.filter((s) => s.topic !== 'sports' && s.clips.some((c) => c.country === country));
  const only = (s) => s.clips.every((c) => c.country === country);
  return [...here.filter(only), ...here.filter((s) => !only(s))];
}

async function renderWorld() {
  const box = $('#world-list');
  if (!everything) {
    box.textContent = '';
    box.append(el('p', 'group-note', 'Loading\u2026'));
    everything = await loadEverything();
  }
  box.textContent = '';
  const countries = countriesIn(everything);
  for (const [region, label] of Object.entries(REGION_LABEL)) {
    const rows = countries.filter((c) => c.region === region).sort((a, b) => a.country.localeCompare(b.country));
    if (!rows.length) continue;
    box.append(el('h2', 'group-title', label));
    const group = el('div', 'group');
    for (const c of rows) {
      const row = el('button', 'cell nav');
      row.type = 'button';
      const name = el('span', 'place');
      name.append(el('i', '', COUNTRY[c.country]?.[1] ?? '\u{1F30D}'), COUNTRY[c.country]?.[0] ?? c.country);
      const tail = el('span', 'count', `${c.stories} ${c.stories === 1 ? 'story' : 'stories'}`);     // a bare number read as clips or stories
      const end = el('span', 'tail');
      end.append(tail);
      row.append(name, end);
      row.onclick = () => goTo(c.country);
      group.append(row);
    }
    box.append(group);
  }
  box.append(el('p', 'group-note', 'Grouped by where each outlet is based, over the last two days. An outlet\u2019s stories aren\u2019t always about its own country.'));
}

async function goTo(country) {
  count('world');
  everything = everything || await loadEverything();
  leaveFeed();
  place = country;
  lastPlace = country;
  query = ''; pushedList = null;
  renderBar();
  onScrollStart();
  pageOpen = false;
  start();
  show('world', { pushed: true });
  flash(`What outlets in ${COUNTRY[country]?.[0] ?? country} are covering`);
}

async function takeMeSomewhere() {
  everything = everything || await loadEverything();
  const options = countriesIn(everything).filter((c) => c.stories >= SOMEWHERE_MIN && c.country !== lastPlace);
  if (options.length) goTo(options[Math.floor(Math.random() * options.length)].country);
}
$('#somewhere').onclick = takeMeSomewhere;

// ---------------------------------------------------------------- search
function renderRecent() {
  const box = $('#search-recent'), recent = store.get('recentSearches', []);
  box.textContent = '';
  if (!recent.length) {
    box.append(el('p', 'group-note', 'Searches every story from the last two days by the words in its headline.'));
    return;
  }
  box.append(el('h2', 'group-title', 'Recent'));
  const group = el('div', 'group');
  for (const q of recent) {
    const row = el('button', 'cell nav');
    row.type = 'button';
    row.append(el('span', '', q));
    row.onclick = () => runSearch(q);
    group.append(row);
  }
  box.append(group);
}

// at: a story id to open on (a tapped result), else the first match.
async function runSearch(q, from = 'search', at) {
  count('search');
  leaveFeed();
  query = q;
  place = ''; pushedList = null;
  searchFrom = from;
  if (from === 'search') store.set('recentSearches', [q, ...store.get('recentSearches', []).filter((r) => r !== q)].slice(0, RECENT_MAX));
  $('#search-input').blur();
  renderBar();
  onScrollStart();
  feedEl.textContent = '';
  setStatus('Searching\u2026');
  stories = [];
  show(from, { pushed: true });
  everything = everything || await loadEverything();
  start(at && { story: at });
}
$('#search-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q && feed) runSearch(q);
};
// The matching headlines as you type, in the order they'd play; tap one to watch from it, or Search to watch them all.
async function showResults() {
  const input = $('#search-input'), q = input.value.trim(), hint = $('#search-hint'), box = $('#search-results');
  $('#search-recent').hidden = !!q;
  box.textContent = '';
  if (!q || !feed) { hint.textContent = ''; if (!q) renderRecent(); return; }
  everything = everything || await loadEverything();
  if (input.value.trim() !== q) return;      // you typed on while it loaded
  const found = orderStories(matches(everything, q));
  box.textContent = '';
  hint.textContent = found.length ? '' : 'No stories match.';
  if (!found.length) return;
  const group = el('div', 'group');
  for (const s of found) {
    const row = el('button', 'cell headline');
    row.type = 'button';
    const outlets = new Set(s.clips.map((c) => c.channel)).size;
    row.append(el('span', 'headline-title', s.headline), el('span', 'headline-sub', `${outlets} ${outlets === 1 ? 'outlet' : 'outlets'} · ${ago(s.updated)}`));
    row.onclick = () => runSearch(q, 'search', s.id);
    group.append(row);
  }
  box.append(el('h2', 'group-title', `${found.length} ${found.length === 1 ? 'Story' : 'Stories'}`), group);
}
$('#search-input').oninput = showResults;

async function loadEverything() {
  try {
    const r = await fetch(`${FEED_URL.replace('feed.json', 'search.json')}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`search ${r.status}`);
    return bySide((await r.json()).stories);
  } catch {
    return feed.stories;      // better a smaller search than none
  }
}

// Whole words, so "AI" doesn't find "said". Longer words also match their endings ("election" finds "elections").
// Stories with every word first; if there are none, stories with any of them.
function matches(list, q) {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const rx = words.map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}${w.length >= 4 ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu'));
  const text = (s) => [s.headline, ...s.clips.map((c) => c.title)].join(' ');
  const all = list.filter((s) => rx.length && rx.every((r) => r.test(text(s))));
  return all.length ? all : list.filter((s) => rx.some((r) => r.test(text(s))));
}

function orderStories(list) {
  // unseen stories first (feed order = ranking), fully watched ones at the end
  const seen = (s) => s.clips.every((c) => watched.has(c.id));
  const unseen = list.filter((s) => !seen(s));
  return settings.hideWatched ? unseen : [...unseen, ...list.filter(seen).map((s) => ({ ...s, _seen: true }))];
}

function render() {
  feedEl.textContent = '';
  stories.forEach(renderStory);
}

function renderStory(s, si) {
    const sec = el('section', 'story' + (s._seen ? ' seen' : '') + (s.topic === 'sports' ? ' sports' : ''));
    sec.dataset.i = si;
    sec.setAttribute('aria-label', s.headline);

    // The sides control: Left, Center and Right in equal thirds, each with its clips as dots in its colour, so a story's
    // balance shows at a glance and position and name tell the sides apart without colour. Clips off the Left/Right
    // scale get a segment of their own after them. A side with no outlets stays, hollow: that gap is information.
    const segRow = el('div', 'seg-row');
    const sides = el('div', 'sides');
    sides.setAttribute('role', 'group');
    sides.setAttribute('aria-label', s.topic === 'sports' ? 'Outlets covering this story' : 'Rating of the outlets covering this story');
    const groupOf = (c) => (s.topic === 'sports' ? 'all' : SIDES.includes(c.column) ? c.column : 'rest');
    const rest = s.clips.filter((c) => groupOf(c) === 'rest');
    const restLabel = rest.some((c) => c.column === 'state') ? COLUMNS.state : COLUMNS.unrated;
    const segs = s.topic === 'sports' ? [['all', `Sports · ${new Set(s.clips.map((c) => c.channel)).size} outlets`]]
      : [...SIDES.map((k) => [k, COLUMNS[k]]), ...(rest.length ? [['rest', restLabel]] : [])];
    const groups = {};
    for (const [col, label] of segs) {
      const n = s.clips.filter((c) => groupOf(c) === col).length;
      const b = el(col === 'all' ? 'div' : 'button', `side ${col}`);
      if (col === 'rest' && restLabel === COLUMNS.state) b.classList.add('is-state');
      b.dataset.column = col;
      groups[col] = el('span', 'tg');
      groups[col].setAttribute('aria-hidden', 'true');
      if (!n) groups[col].append(el('i', 'none', 'None'));
      b.append(el('span', 'side-name', label), groups[col]);
      if (col !== 'all') {
        b.type = 'button';
        b.setAttribute('aria-label', n ? `${label}, ${n} ${n === 1 ? 'clip' : 'clips'}` : `${label}: no coverage among the outlets here`);
        if (!n) b.setAttribute('aria-disabled', 'true');
        b.onclick = (e) => { if (!e.detail && n) jumpToColumn(si, col); };     // the keyboard; a finger is handled by holdToPick
      }
      sides.append(b);
    }
    segRow.append(sides);

    const clips = el('div', 'clips');
    s.clips.forEach((c, ci) => {
      const clip = el('article', 'clip');
      const slot = el('div', 'slot');
      const yt = el('a', 'yt-link', 'Watch on YouTube');
      yt.href = `https://www.youtube.com/watch?v=${c.id}`; yt.target = '_blank'; yt.rel = 'noopener';
      const compare = el('button', 'compare-btn');
      compare.type = 'button';
      compare.textContent = 'Compare';
      compare.onclick = () => openCompare(si, c.id);
      const meta = el('div', 'meta'), row = el('div', 'row');
      if (videosOn()) {
        // no thumbnail behind the player: between clips, just the outlet's name
        slot.append(el('div', 'wait', c.channel), el('div', 'msg'));
        const snd = el('button', 'snd');
        snd.type = 'button';
        snd.innerHTML = SOUND_ON; snd.setAttribute('aria-label', 'Sound on or off'); snd.onclick = toggleMute;
        const src = el('span', 'src');
        src.append(el('b', '', c.channel), ` · ${byline(c, s)}`);
        row.append(src, snd, s.clips.length > 1 ? compare : yt);
        // YouTube's player shows any funding notice itself (sometimes cut off; Compare has it in full)
        meta.append(el('h2', 'ctitle', c.title), row);
      } else {
        slot.append(textCard(s, c, si));
        row.append(yt, ...(s.clips.length > 1 ? [compare] : []));
        meta.append(row);
      }
      clip.append(slot, meta);
      clips.append(clip);
      const t = el('i');
      t.dataset.i = ci;
      t.dataset.column = c.column;
      groups[groupOf(c)].append(t);
    });
    let t = 0;
    clips.addEventListener('scroll', () => { onScrollStart(); clearTimeout(t); t = setTimeout(settle, 140); }, { passive: true });
    holdToPick(sides, clips, si);
    sec.append(segRow, clips);
    feedEl.append(sec);
    markPosition(si, 0);
}

// Text Only: the clip's own headline, word for word with its outlet, then the first headline from each other side.
// Nothing here loads from YouTube.
function textCard(s, c, si) {
  const card = el('div', 'textcard'), body = el('div', 'tc-body'), sport = s.topic === 'sports';
  const by = el('p', 'tc-by');
  by.append(el('b', '', c.channel), ` · ${byline(c, s, true)}`);
  body.append(el('h2', 'tc-head', c.title), by);
  if (c.note && settings.notes) body.append(el('p', 'tc-note', c.note));
  const others = sport ? s.clips.filter((k) => k.channel !== c.channel).slice(0, 2).map((k) => [null, k])
    : [...Object.entries(sideHeads(s)), ...[s.clips.find((k) => k.column === 'state')].filter(Boolean).map((k) => ['state', k])]
      .filter(([col]) => col !== c.column);
  if (others.length) {
    const box = el('div', 'tc-others');
    box.append(el('p', 'tc-label', sport ? 'Also covering it' : 'How the other sides put it'));
    for (const [col, k] of others) {
      const b = el('button', 'tc-other');
      b.type = 'button';
      if (col) b.dataset.column = col;
      const who = el('span', 'tc-other-by' + (col ? ' dot' : ''), col ? `${COLUMNS[col]} ·` : '');
      if (col) who.dataset.column = col;
      who.append(el('b', '', k.channel));
      b.append(who, el('span', 'tc-other-head', k.title));
      b.onclick = () => { const sc = clipsEl(si); sc.scrollTo({ left: s.clips.indexOf(k) * sc.clientWidth, behavior: SMOOTH }); };
      box.append(b);
    }
    body.append(box);
  }
  card.append(body);
  return card;
}

// Whatever doesn't fit gives way, so nothing is ever cut off and the video keeps the same box on every clip:
// - a Text Only card drops its least important lines first: the funding note (Compare has it), then the
//   State-funded headline, then the other sides' headline text (their outlets stay, a tap away). Left, Center and
//   Right always go together; anything still too tall scrolls.
// - a title too long for the room under the video gets smaller type.
// Done for the stories around the one you're on.
const FIT_STEPS = ['.tc-note', '.tc-other[data-column="state"]', '.tc-other-head'];
function fitCards(sec) {
  if (!sec || sec.dataset.fit) return;
  sec.dataset.fit = '1';
  const over = (list) => list.filter((b) => b.scrollHeight > b.clientHeight + 1);      // read them all, then change
  const cards = [...sec.querySelectorAll('.textcard')];
  for (const step of FIT_STEPS) for (const b of over(cards)) for (const e of b.querySelectorAll(step)) e.style.display = 'none';
  const metas = [...sec.querySelectorAll('.ctitle')].map((t) => t.parentElement);
  for (const size of ['long', 'longer']) for (const m of over(metas)) m.querySelector('.ctitle').classList.add(size);
}

// Hold the sides control (or slide along it): the dots grow, and the clip under your finger comes up.
// A tap jumps to the first clip of the side you tapped.
const HOLD_MS = 250;
function holdToPick(ticks, clips, si) {
  let hold = 0, scrub = false, x0 = null, tapped = null;
  const pick = (x, behavior) => {
    let best = 0, bestD = Infinity;
    for (const t of ticks.querySelectorAll('i[data-i]')) {
      const r = t.getBoundingClientRect(), d = Math.abs(x - r.left - r.width / 2);
      if (d < bestD) { bestD = d; best = +t.dataset.i; }
    }
    if (Math.round(clips.scrollLeft / (clips.clientWidth || 1)) === best) return;
    markPosition(si, best);
    clips.scrollTo({ left: best * clips.clientWidth, behavior });
  };
  const grow = () => { scrub = true; ticks.classList.add('scrub'); };
  const stop = () => { clearTimeout(hold); scrub = false; x0 = null; ticks.classList.remove('scrub'); };
  ticks.addEventListener('pointerdown', (e) => {
    x0 = e.clientX;
    tapped = e.target.closest('button');
    try { ticks.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    hold = setTimeout(() => { grow(); pick(x0, 'auto'); }, HOLD_MS);
  });
  ticks.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    if (!scrub && Math.abs(e.clientX - x0) > DRAG_START) { clearTimeout(hold); grow(); }
    if (scrub) pick(e.clientX, 'auto');
  });
  ticks.addEventListener('pointerup', (e) => {
    if (x0 !== null && !scrub) {
      if (!tapped) pick(e.clientX, SMOOTH);      // sport: one row of dots, so a tap picks the nearest
      else if (tapped.getAttribute('aria-disabled') !== 'true') jumpToColumn(si, tapped.dataset.column);
    }
    stop();
  });
  ticks.addEventListener('pointercancel', stop);
}

function showEnd() {
  ended = true;
  const sec = el('section', 'story end');
  sec.append(el('p', '', pushedList ? 'That’s every story in this list.' : query ? 'That\u2019s every match from the last two days.' : place ? `That\u2019s everything from ${COUNTRY[place]?.[0] ?? place} in the last two days.` : 'That\u2019s everything from the last two days.'));
  const b = el('button', 'filled', place ? 'Take Me Somewhere Else' : pushedList ? 'Back to Recap' : 'Check for New Stories');
  b.type = 'button';
  b.onclick = place ? takeMeSomewhere : pushedList ? () => $('#back').click() : refreshFeed;
  sec.append(b);
  feedEl.append(sec);
}

const sourceList = () => (place ? placeList(everything, place) : everything.filter(inTopic));
// Inside a tab, don't let one outlet lead story after story: small tabs were mostly one Indian outlet.
const SPREAD_GAP = 3;
function spread(list) {
  if (topic === 'all' || place || query) return list;
  const lead = (s) => s.clips[0].channel, rest = [...list], out = [];
  while (rest.length) {
    const recent = out.slice(-SPREAD_GAP).map(lead);
    const i = rest.findIndex((s) => !recent.includes(lead(s)));
    out.push(...rest.splice(Math.max(0, i), 1));
  }
  return out;
}
const inTopic = (s) => (topic === 'all' ? settings.sportsInAll || s.topic !== 'sports' : (s.tags || []).includes(topic));

async function loadMore() {
  if (query || pushedList || ended || loadingMore || !stories.length) return;   // a search or a Recap list already shows all of itself
  loadingMore = true;
  const run = startRun;
  everything = everything || await loadEverything();
  loadingMore = false;
  if (run !== startRun) return;
  if (!reserve) {
    const shown = new Set(stories.flatMap((s) => s.clips.map((c) => c.id)));
    reserve = spread(orderStories(sourceList()).filter((s) => !s.clips.some((c) => shown.has(c.id))));
  }
  for (const s of reserve.splice(0, MORE_STORIES)) {
    stories.push(s);
    renderStory(s, stories.length - 1);
  }
  if (!reserve.length) showEnd();
}

// A tip, like "Tap the video to start": shown once per visit (once ever with device), and gone after FLASH_MS.
const hinted = new Set();
function hint(text, device = false) {
  const ever = store.get('hinted', []);
  if (hinted.has(text) || (device && ever.includes(text))) return;
  hinted.add(text);
  if (device) store.set('hinted', [...ever, text]);
  flash(text);
}
function flash(text) {
  showHint(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (hintEl.textContent === text) showHint(''); }, FLASH_MS);
}

async function refreshFeed() {
  if (refreshing || !feed) return;
  refreshing = true;
  flash('Checking for new stories\u2026');
  try {
    const fresh = await loadFeed();
    const known = new Set(feed.stories.flatMap((s) => s.clips.map((c) => c.id)));
    const added = fresh.stories.some((s) => s.clips.some((c) => !known.has(c.id)));
    feed = latest = fresh;
    markNew(false);
    if (added) {
      everything = null;
      if (query) everything = await loadEverything();
      onScrollStart();
      start();
      flash('New stories added');
    } else {
      flash(`You\u2019re up to date. Updated ${ago(fresh.generated)}.`);
    }
  } catch {
    flash('Couldn\u2019t reach the feed. Check your connection.');
  }
  refreshing = false;
}

function markPosition(s, c) {
  const sec = storyEl(s), column = stories[s].clips[c].column;
  sec.querySelectorAll('.side').forEach((b) => {
    const on = b.dataset.column === column || b.dataset.column === 'all' || (b.dataset.column === 'rest' && !SIDES.includes(column));
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  sec.querySelectorAll('.tg i[data-i]').forEach((t) => t.classList.toggle('on', +t.dataset.i === c));
}

// ---------------------------------------------------------------- navigation
const storyEl = (i) => feedEl.children[i];
const clipsEl = (i) => storyEl(i)?.querySelector('.clips');

function current() {
  const h = feedEl.clientHeight || 1;
  const s = Math.max(0, Math.min(stories.length - 1, Math.round(feedEl.scrollTop / h)));
  const sc = clipsEl(s);
  const c = sc ? Math.round(sc.scrollLeft / (sc.clientWidth || 1)) : 0;
  return [s, Math.max(0, Math.min(stories[s].clips.length - 1, c))];
}
function goStory(d) {
  const [s] = current();
  const t = Math.max(0, Math.min(feedEl.children.length - 1, s + d));
  feedEl.scrollTo({ top: t * feedEl.clientHeight, behavior: SMOOTH });
}
// A clip that can't play: on to the next outlet, or the next story. (A clip that ends just plays again.)
function advance() {
  const s = stories[activeS];
  if (!s) return;
  autoAdvance = true;
  if (activeC + 1 >= s.clips.length) return goStory(1);
  const sc = clipsEl(activeS);
  sc.scrollTo({ left: (activeC + 1) * sc.clientWidth, behavior: SMOOTH });
}
function jumpToColumn(si, column) {
  const ci = stories[si].clips.findIndex((c) => c.column === column || (column === 'rest' && !SIDES.includes(c.column)));
  const sc = clipsEl(si);
  if (ci >= 0 && sc) sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
}

let scrolling = false;
function onScrollStart() {
  if (scrolling) return;
  scrolling = true;
  clearTimeout(watchTimer);
  if (playerReady) player.pauseVideo();
  wrap.classList.add('away');
  if (!g0?.axis) gesture.hidden = true;     // mid-drag, the layer holds your finger: hiding it would drop the drag
}

function settle() {
  scrolling = false;
  if (!stories.length || LANDSCAPE.matches || !inFeedView()) return;   // rotating moves the scroll position: keep the clip we were on
  if (ended && Math.round(feedEl.scrollTop / (feedEl.clientHeight || 1)) >= stories.length) {    // on the end screen
    if (playerReady) player.pauseVideo();
    wrap.hidden = gesture.hidden = true;
    return;
  }
  const [s, c] = current();
  for (const i of [s - 1, s, s + 1]) fitCards(storyEl(i));     // before anything shows them
  if (s !== activeS) {          // a new story opens on the side you were watching, if it has that side
    const ci = stories[s].clips.findIndex((k) => (place ? k.country === place : k.column === openSide()));
    if (ci > 0 && ci !== c) {
      clipsEl(s).scrollLeft = ci * clipsEl(s).clientWidth;
      clearTimeout(feedTimer);
      feedTimer = setTimeout(settle, 140);
      return;
    }
    count('story');
  } else if (c !== activeC && !autoAdvance) {   // you moved sideways yourself; skipping a broken clip doesn't change your side
    if (stories[s].topic !== 'sports') side = stories[s].clips[c].column;
    store.set('knowsSideways', true);
    if (hintEl.textContent === SIDEWAYS_HINT) showHint('');
  }
  autoAdvance = false;
  activate(s, c);
  if (s >= stories.length - MORE_AT) loadMore();
}

function hintSideways() {
  if (!store.get('knowsSideways', false) && stories[activeS]?.clips.length > 1) hint(SIDEWAYS_HINT, true);
}

function activate(s, c) {
  const clip = stories[s].clips[c];
  markPosition(s, c);
  if (!videosOn()) { activeS = s; activeC = c; return; }
  placePlayer(s, c);
  const same = clip.id === currentId;
  activeS = s; activeC = c; currentId = clip.id;
  if (!playerReady) return;
  storyEl(s).querySelectorAll('.clip')[c].classList.remove('err');
  if (!same) showProgress(0);
  if (same) { player.playVideo(); } else if (unlocked) { player.loadVideoById(clip.id); } else { player.cueVideoById(clip.id); }
  armPlayCheck();
}

function placePlayer(s, c) {
  if (!videosOn()) { wrap.hidden = gesture.hidden = true; return; }     // rotating (a resize) put a black box over Text Only
  const slot = storyEl(s).querySelectorAll('.slot')[c];
  const r = slot.getBoundingClientRect();
  Object.assign(wrap.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  Object.assign(gesture.style, { left: `${r.left}px`, top: `${r.top + r.height * GESTURE_TOP}px`, width: `${r.width}px`, height: `${r.height * GESTURE_HEIGHT}px` });
  wrap.hidden = false;
  wrap.classList.remove('away');
  gesture.hidden = !unlocked;     // before the first real tap, taps must reach the YouTube player itself
}

// ---------------------------------------------------------------- player
function armPlayCheck() {
  clearTimeout(playCheck);
  if (!unlocked) { hint('Tap the video to start'); return; }
  playCheck = setTimeout(() => {
    if (!playing) {               // iOS refused to start: hand the next tap to the player itself
      gesture.hidden = true;
      hint('Tap the video to play');
    }
  }, PLAY_CHECK_MS);
}

const progressFill = $('#progress i');
let progressTimer = 0;
function showProgress(at) { progressFill.style.transform = `scaleX(${at})`; }
function trackProgress() {
  clearInterval(progressTimer);
  const tick = () => { const d = player.getDuration() || 0; showProgress(d ? Math.min(1, player.getCurrentTime() / d) : 0); };
  tick();
  if (playing) progressTimer = setInterval(tick, 250);
}

function onState(e) {
  const S = window.YT.PlayerState;
  playing = e.data === S.PLAYING;
  trackProgress();
  if (playing) {
    if (!unlocked) { unlocked = true; }
    gesture.hidden = false;
    showHint('');
    hintSideways();
    clearTimeout(watchTimer);
    const id = currentId;
    watchTimer = setTimeout(() => markWatched(id), WATCHED_AFTER_MS);
    updateMuteIcons();
  }
  if (e.data === S.ENDED) {
    markWatched(currentId);
    player.seekTo(0, true);       // plays again until you swipe
    player.playVideo();
  }
}

function onError() {
  const id = currentId;
  const clipEl = storyEl(activeS)?.querySelectorAll('.clip')[activeC];
  if (clipEl) {
    clipEl.classList.add('err');
    const msg = clipEl.querySelector('.msg');
    msg.innerHTML = '';
    const a = el('a', '', 'Open in YouTube'); a.href = `https://www.youtube.com/watch?v=${id}`; a.target = '_blank';
    msg.append('This clip can’t play inside the app. ', a);
  }
  wrap.classList.add('away');
  gesture.hidden = false;
  setTimeout(() => { if (currentId === id) advance(); }, 2500);
}

function toggleMute() {
  if (!playerReady) return;
  player.isMuted() ? player.unMute() : player.mute();
  setTimeout(updateMuteIcons, 100);
}
function updateMuteIcons() {
  if (!playerReady) return;
  const svg = player.isMuted() ? SOUND_OFF : SOUND_ON;
  document.querySelectorAll('.snd').forEach((b) => { b.innerHTML = svg; });
}

function loadYouTubeApi() {
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}

async function createPlayer(firstId) {
  await loadYouTubeApi();
  player = new window.YT.Player('player', {
    width: '100%', height: '100%', videoId: firstId,
    playerVars: { playsinline: 1, controls: 0, rel: 0, fs: 0, iv_load_policy: 3, disablekb: 1, origin: location.origin },
    events: {
      onReady: () => { playerReady = true; settle(); },
      onStateChange: onState,
      onError,
    },
  });
}

// ---------------------------------------------------------------- gestures on top of the video
// g0: the touch in progress. axis: 'y' (stories) or 'x' (outlets) once it moved DRAG_START, else still a possible tap.
let g0 = null;
const dragged = (g) => (g.axis === 'y' ? feedEl : clipsEl(g.s));
gesture.addEventListener('pointerdown', (e) => {
  document.activeElement?.blur();      // the touchstart handler below would otherwise leave the keyboard up
  const [s] = current();
  g0 = { x: e.clientX, y: e.clientY, t: Date.now(), axis: null, s, top: feedEl.scrollTop, left: clipsEl(s)?.scrollLeft ?? 0 };
  try { gesture.setPointerCapture(e.pointerId); } catch { /* not supported */ }
});
gesture.addEventListener('pointermove', (e) => {
  if (!g0) return;
  const dx = e.clientX - g0.x, dy = e.clientY - g0.y;
  if (!g0.axis) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_START) return;
    g0.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (!dragged(g0)) { g0 = null; return; }
    dragged(g0).style.scrollSnapType = 'none';     // snapping would fight the finger
  }
  if (g0.axis === 'y') feedEl.scrollTop = g0.top - dy;
  else dragged(g0).scrollLeft = g0.left - dx;
});
// Let go: glide on, or spring back, then snapping takes over again.
function letGo(g, d, dt) {
  const el = dragged(g), size = g.axis === 'y' ? el.clientHeight : el.clientWidth;
  const from = g.axis === 'y' ? g.s : Math.round(g.left / size);
  const step = Math.abs(d) > size * DRAG_COMMIT || Math.abs(d) / Math.max(dt, 1) > FLICK_PX_MS ? (d < 0 ? 1 : -1) : 0;
  const last = g.axis === 'y' ? feedEl.children.length - 1 : stories[g.s].clips.length - 1;
  const to = Math.max(0, Math.min(last, from + step));
  el.scrollTo({ [g.axis === 'y' ? 'top' : 'left']: to * size, behavior: SMOOTH });
  setTimeout(() => { el.style.scrollSnapType = ''; }, 450);
  if (g.axis === 'x' && from + step > last) setTimeout(() => goStory(1), 200);      // past the last outlet: the next story
}
gesture.addEventListener('pointerup', (e) => {
  if (!g0) return;
  const g = g0, dx = e.clientX - g.x, dy = e.clientY - g.y, dt = Date.now() - g.t;
  g0 = null;
  if (g.axis) return letGo(g, g.axis === 'y' ? dy : dx, dt);
  if (dt >= 400 || !playerReady) return;
  // Double-tap the left or right half to go back or forward, as on YouTube; keep tapping to skip more.
  // So a single tap (pause/play) waits DOUBLE_TAP_MS to be sure it isn't the first of two.
  const now = Date.now(), r = gesture.getBoundingClientRect();
  clearTimeout(tapTimer);
  if (now - lastTap < DOUBLE_TAP_MS) {
    lastTap = now;
    skip(e.clientX < r.left + r.width / 2 ? -SKIP_S : SKIP_S);
    return;
  }
  lastTap = now;
  tapTimer = setTimeout(() => { lastTap = 0; playing ? player.pauseVideo() : player.playVideo(); }, DOUBLE_TAP_MS);
});
let lastTap = 0, tapTimer = 0, skipTimer = 0;
function skip(d) {
  const end = player.getDuration() || 0;
  player.seekTo(Math.max(0, Math.min(end ? end - 1 : Infinity, player.getCurrentTime() + d)), true);
  const f = $('#skip');
  f.textContent = d < 0 ? `−${-d} s` : `+${d} s`;
  f.className = d < 0 ? 'back on' : 'on';
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => f.classList.remove('on'), 600);
}
gesture.addEventListener('pointercancel', () => { const g = g0; g0 = null; if (g?.axis) letGo(g, 0, 1e9); });     // spring back
// Without this, Chromium treats a flick here as a fling and swallows the next tap anywhere on the page.
gesture.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

// ---------------------------------------------------------------- boot
let feedTimer = 0;
feedEl.addEventListener('scroll', () => { onScrollStart(); clearTimeout(feedTimer); feedTimer = setTimeout(settle, 140); }, { passive: true });
LANDSCAPE.addEventListener('change', (e) => {
  if (e.matches) {
    if (playerReady) player.pauseVideo();
    return;
  }
  if (activeS >= 0 && stories[activeS]) {
    feedEl.scrollTop = activeS * feedEl.clientHeight;
    clipsEl(activeS).scrollLeft = activeC * clipsEl(activeS).clientWidth;
  }
  settle();
});
window.addEventListener('resize', () => { if (activeS >= 0 && inFeedView() && stories[activeS]) placePlayer(activeS, activeC); });

// New stories wait behind a dot on the refresh button, with a short note over the sides bar that nothing can be tapped
// through: a "New Stories" button there sat on top of Left, Center and Right, and a tap meant for a side reloaded the feed.
let newWaiting = false;
function markNew(on) { newWaiting = on; renderBar(); }
async function checkForNewStories() {
  if (document.visibilityState !== 'visible' || !feed) return;
  try {
    const fresh = await loadFeed();
    const known = new Set(feed.stories.flatMap((s) => s.clips.map((c) => c.id)));
    if (fresh.stories.some((s) => s.clips.some((c) => !known.has(c.id)))) {
      if (!newWaiting) flash('New stories are in: tap ↻ to see them');
      markNew(true);
    }
    latest = fresh;
    updateBadge();
  } catch { /* offline: keep what we have */ }
}
document.addEventListener('visibilitychange', checkForNewStories);
setInterval(checkForNewStories, CHECK_FEED_MS);

// ---------------------------------------------------------------- welcome + consent
function chooseVideos(on) {
  consent = on ? 'videos' : 'text';
  store.set('consent', consent);
  document.documentElement.classList.toggle('videos', on);
}
function finishWelcome(on) {
  chooseVideos(on);
  count(`mode_${consent}`);      // the day's visit was counted before the choice
  welcomeEl.close();
  if (feed) start(here());      // a shared link may have opened a story behind the welcome
}
$('#consent-videos').onclick = () => finishWelcome(true);
$('#consent-text').onclick = () => finishWelcome(false);
welcomeEl.addEventListener('cancel', (e) => e.preventDefault());      // a real choice, either way

// ---------------------------------------------------------------- settings
let settingsChanged = false, redraw = false;
const toggles = ['hideWatched', 'sportsInAll', 'notes'];
function saveSettings() {
  store.set('settings', settings);
  settingsChanged = true;
}
function syncSettings() {
  $('#set-videos').checked = videosOn();
  $('#set-side').value = settings.side;
  for (const t of toggles) $(`#set-${t}`).checked = settings[t];
  $('#set-clear').textContent = 'Clear Watched History';
  renderMix($('#settings-mix'));
}
for (const t of toggles) {
  $(`#set-${t}`).onchange = (e) => { settings[t] = e.target.checked; saveSettings(); };
}
$('#set-side').onchange = (e) => { settings.side = e.target.value; saveSettings(); };
$('#set-videos').onchange = (e) => {
  chooseVideos(e.target.checked);
  if (e.target.checked) redraw = true;
  else location.reload();     // the only way to fully take the YouTube player back out of the page
};
$('#set-clear').onclick = (e) => {
  watched = new Set();
  store.set('watched', []);
  settingsChanged = true;
  e.target.textContent = 'Cleared';
};
$('#set-reset').onclick = () => {
  if (!confirm('Reset this device? This clears your settings, watched history and video choice.')) return;
  try { localStorage.clear(); } catch { /* private mode etc. */ }
  location.reload();
};

// ---------------------------------------------------------------- compare sheet
function closeSheet(d) {
  if (!d.open || d.classList.contains('closing')) return;
  if (REDUCED) return d.close();
  d.classList.add('closing');
  setTimeout(() => { d.classList.remove('closing'); d.style.transform = ''; d.close(); }, 220);
}
compareEl.querySelector('.done').onclick = () => closeSheet(compareEl);
compareEl.addEventListener('close', () => { if (feed) settle(); });
compareEl.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(compareEl); });
compareEl.addEventListener('click', (e) => { if (e.target === compareEl && e.offsetY < 0) closeSheet(compareEl); });   // the dimmed area above it
const sheetHead = compareEl.querySelector('.sheet-head');
let drag = null;
sheetHead.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  drag = e.clientY;
  sheetHead.setPointerCapture(e.pointerId);
});
sheetHead.addEventListener('pointermove', (e) => { if (drag !== null) compareEl.style.transform = `translateY(${Math.max(0, e.clientY - drag)}px)`; });
const endDrag = (e) => {
  if (drag === null) return;
  const moved = e.clientY - drag;
  drag = null;
  if (moved > 100) closeSheet(compareEl); else compareEl.style.transform = '';
};
sheetHead.addEventListener('pointerup', endDrag);
sheetHead.addEventListener('pointercancel', endDrag);

function gap(ms) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return m < 60 ? `${m}m` : `${h}h${h < 10 && m % 60 ? ` ${m % 60}m` : ''}`;
}
// Outlets in the order they first posted about the story, and how fast it crossed regions.
// Only for a story under FIRST_MAX_H old, and from the same clips as the list above it. On a story that ran for days,
// "first" only meant "oldest clip still in the two-day window", and contradicted the list.
const FIRST_MAX_H = 12, FIRST_ROWS = 6;
function timeline(s) {
  const at = (c) => Date.parse(c.published);
  const order = [...s.clips].sort((a, b) => at(a) - at(b)), t0 = at(order[0]);
  if (Date.now() - t0 > FIRST_MAX_H * 3600e3) return [];
  const group = el('div', 'group');
  order.slice(0, FIRST_ROWS).forEach((c, i) => {
    const row = el('div', 'cell');
    row.append(el('span', '', `${COUNTRY[c.country]?.[1] ?? ''} ${c.channel}`.trim()),
      el('span', 'count', i ? `+${gap(at(c) - t0)}` : `First, ${ago(c.published)}`));
    group.append(row);
  });
  if (order.length > FIRST_ROWS) group.append(el('div', 'cell', `${order.length - FIRST_ROWS} more`));
  const reached = new Map();
  for (const c of order) if (!reached.has(c.region)) reached.set(c.region, at(c));
  const spread = reached.size > 1 ? `It reached ${reached.size} regions within ${gap(Math.max(...reached.values()) - t0)}. ` : '';
  return [el('h2', 'group-title', 'Who Covered It First'), group,
    el('p', 'group-note', `${spread}By when each clip above went up on YouTube, which can come after an outlet's live or written reporting.`)];
}

// ---------------------------------------------------------------- share
// The bar's share button: whatever story and outlet you're on.
$('#bar-share').onclick = () => { const s = stories[activeS]; if (s) shareStory(s, s.clips[activeC]?.id ?? s.clips[0].id); };
async function shareStory(s, currentClip) {
  count('share');
  const url = `${location.origin}${location.pathname}?story=${encodeURIComponent(s.id)}&clip=${encodeURIComponent(currentClip)}`;
  const data = { title: s.headline, text: 'How different outlets covered it', url };
  try {
    const blob = await storyCard(s, currentClip);
    const files = blob ? [new File([blob], 'swipe-news.png', { type: 'image/png' })] : [];
    if (files.length && navigator.canShare?.({ files })) return await navigator.share({ ...data, files });
    if (navigator.share) return await navigator.share(data);
  } catch (e) {
    if (e?.name === 'AbortError') return;      // you closed the share sheet
    // some browsers have navigator.share but refuse it (NotAllowedError): copy the link instead
  }
  try {
    await navigator.clipboard.writeText(url);
    flash('Link copied');
  } catch {
    flash('Couldn’t share this story.');
  }
}

function openCompare(si, currentClip) {
  count('compare');
  const s = stories[si], box = $('#compare-body');
  box.textContent = '';
  box.append(el('p', 'compare-story', s.headline));
  if (!store.get('knowsRatings', false) && s.topic !== 'sports') {      // the first Compare explains the sides, not the welcome
    store.set('knowsRatings', true);
    box.append(el('p', 'compare-intro', 'Left, Center and Right are Media Bias/Fact Check\u2019s ratings of each outlet as a whole, on a US left\u2013right scale, not of these headlines. Each headline shows its outlet\u2019s exact rating, like Lean Left. Outlets a government funds have their own group.'));
  }
  for (const [col, label] of Object.entries(COLUMNS)) {
    const clips = s.clips.filter((c) => c.column === col);
    const head = (n) => {
      const h = el('h2', 'group-title', label);
      h.dataset.column = col;
      if (n) h.append(el('span', 'n', `${n} ${n === 1 ? 'outlet' : 'outlets'}`));
      return h;
    };
    if (s.topic !== 'sports' && SIDES.includes(col) && !clips.length) {
      box.append(head(0), el('p', 'group-note', 'No coverage among the outlets here.'));
      continue;
    }
    if (!clips.length) continue;
    if (s.topic !== 'sports') box.append(head(clips.length));     // left and right mean nothing for sport
    if (s.topic !== 'sports' && col === 'state') box.append(el('p', 'group-note state-note', 'YouTube notes that a government funds these outlets, in whole or in part, so they aren\u2019t placed on the US left\u2013right scale.'));
    const group = el('div', 'group');
    for (const c of clips) {
      const b = el('button', 'cell headline' + (c.id === currentClip ? ' now' : ''));
      b.type = 'button';
      if (c.id === currentClip) b.setAttribute('aria-current', 'true');
      const by = el('span', 'headline-sub');
      by.append(el('b', '', c.channel), ` \u00b7 ${byline(c, s, true)}`);
      b.append(el('span', 'headline-title', c.title), by);
      if (c.note && settings.notes) b.append(el('span', 'headline-meta', c.note));     // in full: the player's box can cut it off
      b.onclick = () => {
        const ci = s.clips.indexOf(c), sc = clipsEl(si);
        closeSheet(compareEl);
        sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
      };
      group.append(b);
    }
    box.append(group);
  }
  if (s.clips.length > 1) box.append(...timeline(s));
  const share = el('button', 'cell watch-link', 'Share This Story');
  share.type = 'button';
  share.onclick = () => shareStory(s, currentClip);
  const yt = el('a', 'cell link ext watch-link', 'Watch This Clip on YouTube');
  yt.href = `https://www.youtube.com/watch?v=${currentClip}`; yt.target = '_blank'; yt.rel = 'noopener';
  const actions = el('div', 'group actions');
  actions.append(share, yt);
  box.append(actions, el('p', 'group-note', 'Headlines from YouTube videos. Left, Center and Right are Media Bias/Fact Check ratings of whole outlets on a US left\u2013right scale, not judgements of these headlines.'));
  if (playerReady) player.pauseVideo();
  compareEl.showModal();
}

// Where you are, by id, so a rebuilt feed can put you back on the same clip.
const here = () => (stories[activeS] ? { story: stories[activeS].id, clip: stories[activeS].clips[activeC]?.id } : null);

// at: { story, clip } ids to stay on (here()), if that story is still in the rebuilt feed.
// extra: a story to open that this list doesn't have (from Recap), put first.
function start(at, extra) {
  startRun++;
  reserve = null;
  ended = false;
  if (pushedList) {
    stories = pushedList.stories;
  } else if (query) {
    stories = orderStories(matches(everything || feed.stories || [], query));
  } else if (place) {
    const all = orderStories(placeList(everything || [], place));
    const fresh = all.filter((s) => !s._seen).slice(0, MORE_STORIES);
    stories = fresh.length ? fresh : settings.hideWatched ? [] : all.slice(0, MORE_STORIES);
  } else {
    // Watched stories wait until the end, so they never sit in front of ones you haven't seen.
    const pool = (feed.stories || []).filter(inTopic);
    let fresh = orderStories(pool).filter((s) => !s._seen);
    if (!fresh.length) {       // nothing left in the top stories for this tab: look through all of them
      if (!everything) {
        const run = startRun;
        setStatus('Loading\u2026');
        loadEverything().then((all) => { everything = all; if (run === startRun) start(at, extra); });
        return;
      }
      const all = orderStories(everything.filter(inTopic));
      fresh = all.filter((s) => !s._seen).slice(0, MORE_STORIES);
      if (!fresh.length) fresh = settings.hideWatched ? [] : all;
    }
    stories = spread(fresh);
  }
  if (extra && !stories.some((s) => s.id === extra.id)) stories.unshift(extra);
  draw(at);
}

// Draws `stories` and opens on `at` if it's there, else on the first story.
function draw(at) {
  currentId = null;
  activeS = -1;
  $('#bar-share').hidden = !stories.length;
  if (!stories.length) {
    feedEl.textContent = '';
    wrap.hidden = gesture.hidden = true;
    scrolling = false;
    if (query) { setStatus(`No results for \u201C${query}\u201D in the last two days.`); return; }
    if (place) { setStatus('Nothing new from here right now.'); return; }
    setStatus(topic === 'all' ? 'No stories right now. Check back soon.' : `No ${TOPICS[topic].toLowerCase()} stories right now.`);
    return;
  }
  setStatus('');
  render();
  if (query || pushedList || ended) showEnd();
  const si = at ? stories.findIndex((s) => s.id === at.story) : -1;
  fitCards(storyEl(Math.max(si, 0)));
  const ci = si < 0 ? 0 : Math.max(0, stories[si].clips.findIndex((c) => c.id === at.clip));
  feedEl.scrollTop = Math.max(si, 0) * feedEl.clientHeight;
  if (si >= 0) {
    clipsEl(si).scrollLeft = ci * clipsEl(si).clientWidth;
    activeS = si; activeC = ci;     // the same story, not a new one: settle mustn't turn it to your usual side
  }
  if (playerStarted || !videosOn()) { settle(); return; }
  playerStarted = true;
  createPlayer(stories[Math.max(si, 0)].clips[ci].id);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* offline just won't work */ });

countVisit();

(async function boot() {
  renderBar();
  show('news');
  if (!consent) welcomeEl.showModal();
  try {
    feed = latest = await loadFeed();
  } catch (e) {
    setStatus('Couldn’t load the feed. Check your connection.', true);
    return;
  }
  // a shared link: ?story=…&clip=…, found by the clip too in case the story's id changed since
  const linked = params.get('story'), linkedClip = params.get('clip');
  if (linked) {
    count('shared_open');
    history.replaceState(null, '', params.get('feed') ? `?feed=${encodeURIComponent(params.get('feed'))}` : location.pathname);
    const find = (list) => list.find((s) => s.id === linked) || list.find((s) => s.clips.some((c) => c.id === linkedClip));
    const s = find(feed.stories) || find(everything = await loadEverything());
    if (s) { openStory(s, linkedClip); updateBadge(); return; }
    flash('That story is more than two days old, so it’s no longer here.');
  }
  start();
  if (!navigator.onLine) flash(`You’re offline. These are the stories from ${ago(feed.generated)}.`);
  updateBadge();
  setTimeout(checkForNewStories, NEWER_CHECK_MS);     // on a slow start the saved copy came first: offer the newer one
})();
