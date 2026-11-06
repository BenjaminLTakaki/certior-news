// Swipe News — one story per screen. Swipe up/down = next/previous story,
// swipe left/right = the same story from another outlet.
// One YouTube player is reused for every clip and laid over the active clip's video area.

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
const COLUMNS = { left: 'Left', center: 'Center', right: 'Right', unrated: 'Not rated' };
// The outlet's own rating. Lean Left swipes under Left and Lean Right under Right, so this tells them apart.
const LEAN = { left: 'Left', 'lean-left': 'Lean Left', center: 'Center', 'lean-right': 'Lean Right', right: 'Right', unrated: 'Not rated' };
// After the outlet: "Lean Left · 3h ago · Canada". On a narrow phone with videos on the row runs out of room, so the
// country, which the Compare sheet and World tab also show, comes last. Sport has no sides, so no rating.
const byline = (c, s) => [s.topic !== 'sports' && LEAN[c.lean], ago(c.published), c.country].filter(Boolean).join(' · ');
const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');   // a sideways phone: see #rotate
const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/>${path}</svg>`;
const SOUND_ON = icon('<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
const SOUND_OFF = icon('<path d="m16 9.5 5 5m0-5-5 5"/>');
const PLAY_CHECK_MS = 1800;   // if a clip isn't playing after this, ask for a tap
const WATCHED_AFTER_MS = 3000;
const DOUBLE_TAP_MS = 250, SKIP_S = 10;
const SIDEWAYS_HINT = 'Swipe sideways for other outlets';
const SIDEWAYS_HINT_MS = 5000, SIDEWAYS_HINTS = 3;
const SETTINGS_DEFAULTS = { side: '', auto: true, hideWatched: false, sportsInAll: true, notes: true };
// YouTube forbids disabling the links inside its player, and they sit along its top and bottom edges.
// So swipes are only caught in the middle band; everything above and below reaches YouTube.
const GESTURE_TOP = 0.25, GESTURE_HEIGHT = 0.5;
const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/></svg>';
const MORE_AT = 8, MORE_STORIES = 40;      // the feed is the top stories only: fetch the rest when you get this close to its end
const FLASH_MS = 3000;
const SHUFFLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.500 7.500h3.300c1.500 0 2.800.7 3.700 1.900l3 4.200c.9 1.200 2.200 1.900 3.700 1.900h3.300M3.500 16.500h3.300c1.500 0 2.800-.7 3.700-1.900M14.500 10.400c.9-1.200 1.200-2.900 3.700-2.900h2.300M18 5l2.500 2.500L18 10M18 14l2.500 2.500L18 19"/></svg>';
const CHECK_FEED_MS = 2 * 60000;

const $ = (s, el = document) => el.querySelector(s);
const feedEl = $('#feed'), wrap = $('#player-wrap'), gesture = $('#gesture');
const hintEl = $('#hint'), statusEl = $('#status'), newPill = $('#new-pill');
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
let consent = store.get('consent', null);    // 'videos' or 'text'. Nothing from YouTube loads until it is 'videos'.
const videosOn = () => consent === 'videos';
let watched = new Set(store.get('watched', []));
function markWatched(id) {
  if (watched.has(id)) return;
  watched.add(id);
  store.set('watched', [...watched].slice(-3000));
  const clip = stories[activeS]?.clips.find((c) => c.id === id);
  if (clip && clip.column !== 'unrated') recordMix(clip.column);
}

// ---------------------------------------------------------------- your mix: on this device only, never a reward
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
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
    const bar = el('span', 'mix-bar');
    const fill = el('i');
    fill.style.width = `${Math.round((n / sum) * 100)}%`;
    bar.append(fill);
    row.append(el('span', '', COLUMNS[k]), bar, el('span', 'mix-n', String(n)));
    box.append(row);
  }
  const least = Object.keys(totals).reduce((a, b) => (totals[b] < totals[a] ? b : a));
  if (sum >= 5 && settings.side !== least) {
    const b = el('button', 'mix-try', `Open Stories on ${COLUMNS[least]} for a While`);
    b.onclick = () => {
      settings.side = least;
      side = least;
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
let query = '', place = '', everything = null;
let tab = 'news', pageOpen = false, lastPlace = '';   // pageOpen: a full page covers the feed, so the player stays out of the way
let reserve = null, loadingMore = false, ended = false, startRun = 0, flashTimer = 0, refreshing = false;
let side = settings.side || null, autoAdvance = false, hintTimer = 0;     // side: the one you last chose, kept from story to story
let playCheck = 0, watchTimer = 0;

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
async function loadFeed() {
  const r = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`feed ${r.status}`);
  return r.json();
}

const inFeedView = () => !pageOpen;

function renderBar() {
  const back = $('#back'), action = $('#bar-action'), select = $('#topic'), pushed = place || query;
  back.hidden = !pushed;
  back.textContent = place ? 'World' : 'Search';
  select.hidden = !!pushed;
  $('#bar-chevron').toggleAttribute('hidden', !!pushed);      // an svg has no .hidden property
  $('#bar-title').textContent = place ? `${COUNTRY[place]?.[1] ?? ''} ${COUNTRY[place]?.[0] ?? place}`.trim() : query ? `\u201C${query}\u201D` : TOPICS[topic];
  select.value = topic;
  action.innerHTML = place ? SHUFFLE_ICON : REFRESH_ICON;
  action.setAttribute('aria-label', place ? 'Take me somewhere else' : 'Check for new stories');
  action.onclick = place ? takeMeSomewhere : refreshFeed;
}

$('#topic').append(...Object.entries(TOPICS).map(([key, label]) => { const o = el('option', '', label); o.value = key; return o; }));
$('#topic').onchange = (e) => {
  topic = e.target.value;
  store.set('topic', topic);
  renderBar();
  if (feed) { onScrollStart(); start(); }
};
$('#back').onclick = () => {
  const from = place ? 'world' : 'search';
  place = ''; query = '';
  renderBar();
  onScrollStart();
  pageOpen = true;      // the page comes back first, so nothing plays behind it while the feed rebuilds
  if (feed) start();
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
  for (const name of ['world', 'search', 'settings']) $(`#page-${name}`).hidden = !(pageOpen && name === next);
  if (pageOpen) {
    onScrollStart();
    showHint('');
    if (next === 'world') renderWorld();
    if (next === 'search') { renderRecent(); $('#search-input').focus(); }    // inside the tap, so iOS opens the keyboard
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
      if (place || query) {        // tapping a tab returns to its root, as everywhere on iOS
        place = ''; query = '';
        renderBar();
        pageOpen = false;
        onScrollStart();
        if (feed) start();
      } else if (tab === 'news') {
        feedEl.scrollTo({ top: 0, behavior: SMOOTH });
      }
      return show('news');
    }
    if (place || query) {
      place = ''; query = '';
      renderBar();
      pageOpen = true;
      if (feed) start();
    }
    show(next);
  };
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
      const tail = el('span', 'count', String(c.stories));
      tail.setAttribute('aria-label', `${c.stories} stories`);
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
  everything = everything || await loadEverything();
  place = country;
  lastPlace = country;
  query = '';
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

async function runSearch(q) {
  query = q;
  place = '';
  store.set('recentSearches', [q, ...store.get('recentSearches', []).filter((r) => r !== q)].slice(0, RECENT_MAX));
  $('#search-input').blur();
  renderBar();
  onScrollStart();
  feedEl.textContent = '';
  setStatus('Searching\u2026');
  stories = [];
  show('search', { pushed: true });
  everything = everything || await loadEverything();
  start();
}
$('#search-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q && feed) runSearch(q);
};
// How many stories match as you type, and that Search on the keyboard opens them.
$('#search-input').oninput = async (e) => {
  const q = e.target.value.trim(), hint = $('#search-hint');
  if (!q || !feed) { hint.textContent = ''; return; }
  everything = everything || await loadEverything();
  if (e.target.value.trim() !== q) return;      // you typed on while it loaded
  const n = matches(everything, q).length;
  hint.textContent = n ? `${n} ${n === 1 ? 'story matches' : 'stories match'}. Press Search to watch ${n === 1 ? 'it' : 'them'}.` : 'No stories match.';
};

async function loadEverything() {
  try {
    const r = await fetch(`${FEED_URL.replace('feed.json', 'search.json')}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`search ${r.status}`);
    return (await r.json()).stories;
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

    const segRow = el('div', 'seg-row');
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Rating of the outlets covering this story');
    for (const [col, label] of Object.entries(COLUMNS)) {
      if (col === 'unrated' && !s.sides.unrated) continue;
      const b = el('button', '', label);      // a side with no outlets stays visible but off: that gap is information
      b.type = 'button';
      b.dataset.column = col;
      b.disabled = !s.sides[col];
      if (!s.sides[col]) b.setAttribute('aria-label', `${label}: no coverage among the outlets here`);
      b.onclick = () => jumpToColumn(si, col);
      seg.append(b);
    }
    if (s.topic === 'sports') {     // left and right mean nothing for sport, but an empty row looked broken
      const n = new Set(s.clips.map((c) => c.channel)).size;
      segRow.append(el('span', 'seg-note', `Sports · ${n} ${n === 1 ? 'outlet' : 'outlets'}`));
    } else {
      segRow.append(seg);
    }

    const clips = el('div', 'clips');
    const ticks = el('div', 'ticks');
    s.clips.forEach((c) => {
      const clip = el('article', 'clip');
      const slot = el('div', 'slot');
      if (videosOn()) {
        const img = el('img');
        img.alt = '';
        img.dataset.src = `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`;     // set by showThumbs when the story comes up
        slot.append(img, el('div', 'msg'));
      } else {
        const off = el('div', 'off');
        const on = el('button', 'filled', 'Turn On Videos');
        on.type = 'button';
        on.onclick = () => { chooseVideos(true); onScrollStart(); draw({ story: s.id, clip: c.id }); };    // same stories, now with video
        const open = el('a', '', 'Watch on YouTube');
        open.href = `https://www.youtube.com/watch?v=${c.id}`; open.target = '_blank'; open.rel = 'noopener';
        off.append(el('b', '', 'Videos Are Off'), el('span', '', 'YouTube can set cookies on this device when they\u2019re on.'), on, open);
        slot.append(off);
      }

      const meta = el('div', 'meta');
      const row = el('div', 'row');
      const src = el('span', 'src');
      src.append(el('b', '', c.channel), ` · ${byline(c, s)}`);
      const snd = el('button', 'snd');
      snd.innerHTML = SOUND_ON; snd.setAttribute('aria-label', 'Sound on or off'); snd.onclick = toggleMute;
      const compare = el('button', 'compare-btn', 'Compare');
      compare.onclick = () => openCompare(si, c.id);
      const yt = el('a', '', 'YouTube');
      yt.href = `https://www.youtube.com/watch?v=${c.id}`; yt.target = '_blank'; yt.rel = 'noopener';
      row.append(src, ...(videosOn() ? [snd] : []), s.clips.length > 1 ? compare : yt);
      meta.append(el('h2', 'ctitle', c.title));
      if (c.note && settings.notes) meta.append(el('p', 'note', c.note));    // YouTube's box in the player cuts this off, and we can't change it
      meta.append(row);
      clip.append(slot, meta);
      clips.append(clip);
      ticks.append(el('i'));
    });
    let t = 0;
    clips.addEventListener('scroll', () => { onScrollStart(); clearTimeout(t); t = setTimeout(settle, 140); }, { passive: true });
    sec.append(segRow, ticks, clips);
    feedEl.append(sec);
    markPosition(si, 0);
}

function showEnd() {
  ended = true;
  const sec = el('section', 'story end');
  sec.append(el('p', '', query ? 'That\u2019s every match from the last two days.' : place ? `That\u2019s everything from ${COUNTRY[place]?.[0] ?? place} in the last two days.` : 'That\u2019s everything from the last two days.'));
  const b = el('button', 'filled', place ? 'Take Me Somewhere Else' : 'Check for New Stories');
  b.type = 'button';
  b.onclick = place ? takeMeSomewhere : refreshFeed;
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
  if (query || ended || loadingMore || !stories.length) return;   // a search already shows every match
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
    feed = fresh;
    newPill.hidden = true;
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
  sec.querySelectorAll('.seg button').forEach((b) => {
    const on = b.dataset.column === column;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  sec.querySelectorAll('.ticks i').forEach((t, i) => t.classList.toggle('on', i === c));
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
function goClip(d) {
  const [s, c] = current();
  const sc = clipsEl(s);
  const n = stories[s].clips.length;
  if (c + d >= n && d > 0) return goStory(1);          // past the last side -> next story
  sc.scrollTo({ left: Math.max(0, Math.min(n - 1, c + d)) * sc.clientWidth, behavior: SMOOTH });
}
function jumpToColumn(si, column) {
  const ci = stories[si].clips.findIndex((c) => c.column === column);
  const sc = clipsEl(si);
  if (ci >= 0 && sc) sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
}

let scrolling = false;
function onScrollStart() {
  if (scrolling) return;
  scrolling = true;
  clearTimeout(watchTimer);
  if (playerReady) player.pauseVideo();
  wrap.classList.add('off');
  gesture.hidden = true;
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
  if (s !== activeS) {          // a new story opens on the side you were watching, if it has that side
    const ci = stories[s].clips.findIndex((k) => (place ? k.country === place : k.column === side));
    if (ci > 0 && ci !== c) {
      clipsEl(s).scrollLeft = ci * clipsEl(s).clientWidth;
      clearTimeout(feedTimer);
      feedTimer = setTimeout(settle, 140);
      return;
    }
  } else if (c !== activeC && !autoAdvance) {   // you moved sideways yourself; a clip ending doesn't change your side
    if (stories[s].topic !== 'sports') side = stories[s].clips[c].column;
    store.set('knowsSideways', true);
    if (hintEl.textContent === SIDEWAYS_HINT) showHint('');
  }
  autoAdvance = false;
  showThumbs(s, c);
  activate(s, c);
  if (s >= stories.length - MORE_AT) loadMore();
}

// Thumbnails only for the clip you're on, its neighbours, and the next story. Loading them all up front
// sent 35 images (about 500 KB) at once, which held YouTube's player back on a phone connection.
function showThumbs(si, ci) {
  const load = (img) => { if (img?.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; } };
  const imgs = storyEl(si)?.querySelectorAll('.slot img') || [];
  for (const i of [ci - 1, ci, ci + 1]) load(imgs[i]);
  load(storyEl(si + 1)?.querySelector('.slot img'));
}

function hintSideways() {
  const shown = store.get('sidewaysHints', 0);
  if (store.get('knowsSideways', false) || shown >= SIDEWAYS_HINTS || stories[activeS]?.clips.length < 2) return;
  store.set('sidewaysHints', shown + 1);
  showHint(SIDEWAYS_HINT);
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { if (hintEl.textContent === SIDEWAYS_HINT) showHint(''); }, SIDEWAYS_HINT_MS);
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
  if (same) { player.playVideo(); } else if (unlocked) { player.loadVideoById(clip.id); } else { player.cueVideoById(clip.id); }
  armPlayCheck();
}

function placePlayer(s, c) {
  const slot = storyEl(s).querySelectorAll('.slot')[c];
  const r = slot.getBoundingClientRect();
  Object.assign(wrap.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  Object.assign(gesture.style, { left: `${r.left}px`, top: `${r.top + r.height * GESTURE_TOP}px`, width: `${r.width}px`, height: `${r.height * GESTURE_HEIGHT}px` });
  wrap.hidden = false;
  wrap.classList.remove('off');
  gesture.hidden = !unlocked;     // before the first real tap, taps must reach the YouTube player itself
}

// ---------------------------------------------------------------- player
function armPlayCheck() {
  clearTimeout(playCheck);
  if (!unlocked) { showHint('Tap the video to start'); return; }
  playCheck = setTimeout(() => {
    if (!playing) {               // iOS refused to start: hand the next tap to the player itself
      gesture.hidden = true;
      showHint('Tap the video to play');
    }
  }, PLAY_CHECK_MS);
}

function onState(e) {
  const S = window.YT.PlayerState;
  playing = e.data === S.PLAYING;
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
    if (settings.auto) { autoAdvance = true; goClip(1); }
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
  wrap.classList.add('off');
  gesture.hidden = false;
  setTimeout(() => { if (currentId === id) { autoAdvance = true; goClip(1); } }, 2500);
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
let g0 = null;
gesture.addEventListener('pointerdown', (e) => {
  document.activeElement?.blur();      // the touchstart handler below would otherwise leave the keyboard up
  g0 = { x: e.clientX, y: e.clientY, t: Date.now() };
  try { gesture.setPointerCapture(e.pointerId); } catch { /* not supported */ }
});
gesture.addEventListener('pointerup', (e) => {
  if (!g0) return;
  const dx = e.clientX - g0.x, dy = e.clientY - g0.y, dt = Date.now() - g0.t;
  g0 = null;
  if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) return goStory(dy < 0 ? 1 : -1);
  if (Math.abs(dx) > 40) return goClip(dx < 0 ? 1 : -1);
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
gesture.addEventListener('pointercancel', () => { g0 = null; });
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

async function checkForNewStories() {
  if (document.visibilityState !== 'visible' || !feed) return;
  try {
    const fresh = await loadFeed();
    const known = new Set(feed.stories.flatMap((s) => s.clips.map((c) => c.id)));
    if (fresh.stories.some((s) => s.clips.some((c) => !known.has(c.id)))) {
      newPill.hidden = false;
      newPill.onclick = () => { newPill.hidden = true; feed = fresh; start(); };
    }
  } catch { /* offline: keep what we have */ }
}
document.addEventListener('visibilitychange', checkForNewStories);
setInterval(checkForNewStories, CHECK_FEED_MS);

// ---------------------------------------------------------------- welcome + consent
function chooseVideos(on) {
  consent = on ? 'videos' : 'text';
  store.set('consent', consent);
}
$('#welcome-next').onclick = () => {
  $('#welcome-1').hidden = true;
  $('#welcome-2').hidden = false;
  $('#welcome-2 h1').focus?.();
};
function finishWelcome(on) {
  chooseVideos(on);
  welcomeEl.close();
  if (feed) start();
}
$('#consent-videos').onclick = () => finishWelcome(true);
$('#consent-text').onclick = () => finishWelcome(false);
welcomeEl.addEventListener('cancel', (e) => e.preventDefault());      // a real choice, either way

// ---------------------------------------------------------------- settings
let settingsChanged = false, redraw = false;
const toggles = ['auto', 'hideWatched', 'sportsInAll', 'notes'];
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
$('#set-side').onchange = (e) => { settings.side = e.target.value; side = settings.side || null; saveSettings(); };
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

function openCompare(si, currentClip) {
  const s = stories[si], box = $('#compare-body');
  box.textContent = '';
  for (const [col, label] of Object.entries(COLUMNS)) {
    const clips = s.clips.filter((c) => c.column === col);
    if (s.topic !== 'sports' && col !== 'unrated' && !clips.length) {
      box.append(el('h2', 'group-title', label), el('p', 'group-note', 'No coverage among the outlets here.'));
      continue;
    }
    if (!clips.length) continue;
    if (s.topic !== 'sports') box.append(el('h2', 'group-title', label));     // left and right mean nothing for sport
    const group = el('div', 'group');
    for (const c of clips) {
      const b = el('button', 'cell headline' + (c.id === currentClip ? ' now' : ''));
      b.type = 'button';
      if (c.id === currentClip) b.setAttribute('aria-current', 'true');
      b.append(el('span', 'headline-title', c.title), el('span', 'headline-sub', `${c.channel} \u00b7 ${byline(c, s)}`));
      b.onclick = () => {
        const ci = s.clips.indexOf(c), sc = clipsEl(si);
        closeSheet(compareEl);
        sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
      };
      group.append(b);
    }
    box.append(group);
  }
  const yt = el('a', 'watch-link', 'Watch This Clip on YouTube');
  yt.href = `https://www.youtube.com/watch?v=${currentClip}`; yt.target = '_blank'; yt.rel = 'noopener';
  box.append(yt, el('p', 'group-note', 'Headlines from YouTube videos. Sides are outlet ratings from Media Bias/Fact Check, not judgements of these headlines.'));
  if (playerReady) player.pauseVideo();
  compareEl.showModal();
}

// Where you are, by id, so a rebuilt feed can put you back on the same clip.
const here = () => (stories[activeS] ? { story: stories[activeS].id, clip: stories[activeS].clips[activeC]?.id } : null);

// at: { story, clip } ids to stay on (here()), if that story is still in the rebuilt feed.
function start(at) {
  startRun++;
  reserve = null;
  ended = false;
  if (query) {
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
        loadEverything().then((all) => { everything = all; if (run === startRun) start(at); });
        return;
      }
      const all = orderStories(everything.filter(inTopic));
      fresh = all.filter((s) => !s._seen).slice(0, MORE_STORIES);
      if (!fresh.length) fresh = settings.hideWatched ? [] : all;
    }
    stories = spread(fresh);
  }
  draw(at);
}

// Draws `stories` and opens on `at` if it's there, else on the first story.
function draw(at) {
  currentId = null;
  activeS = -1;
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
  if (query || ended) showEnd();
  const si = at ? stories.findIndex((s) => s.id === at.story) : -1;
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

(async function boot() {
  renderBar();
  show('news');
  if (!consent) welcomeEl.showModal();
  try {
    feed = await loadFeed();
  } catch (e) {
    setStatus('Couldn’t load the feed. Check your connection.', true);
    return;
  }
  start();
})();
