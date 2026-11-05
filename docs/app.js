// Swipe News — one story per screen. Swipe up/down = next/previous story,
// swipe left/right = the same story from Left, Center and Right outlets around the world.
// One YouTube player is reused for every clip and laid over the active clip's video area.

const params = new URLSearchParams(location.search);
const FEED_URL = params.get('feed') || 'feed.json';
const TOPICS = { all: 'All', politics: 'Politics', business: 'Business', tech: 'Tech', health: 'Health', climate: 'Climate', crime: 'Crime', disasters: 'Disasters', culture: 'Culture', sports: 'Sports' };
const SIDE_LABEL = { left: 'Left-leaning', center: 'Center', right: 'Right-leaning', unrated: 'Not rated' };
const MIX_DAYS = 7;
const BLIND_KEEP = 40, BLIND_FIRST_READING = 10, BLIND_SETTLED = 20;     // 5 pairs a day: the first reading takes two visits, and old picks fade out so it can shift
const COLUMNS = { left: 'Left', center: 'Center', right: 'Right', unrated: 'Not rated' };
const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');   // a sideways phone: see #rotate
const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/>${path}</svg>`;
const SOUND_ON = icon('<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
const SOUND_OFF = icon('<path d="m16 9.5 5 5m0-5-5 5"/>');
const PLAY_CHECK_MS = 1800;   // if a clip isn't playing after this, ask for a tap
const WATCHED_AFTER_MS = 3000;
const SIDEWAYS_HINT = 'Swipe sideways for other outlets';
const SIDEWAYS_HINT_MS = 5000, SIDEWAYS_HINTS = 3;
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
const SETTINGS_DEFAULTS = { side: '', auto: true, hideWatched: false, sportsInAll: true, notes: true };
// YouTube forbids disabling the links inside its player, and they sit along its top and bottom edges.
// So swipes are only caught in the middle band; everything above and below reaches YouTube.
const GESTURE_TOP = 0.25, GESTURE_HEIGHT = 0.5;
const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/></svg>';
const MORE_AT = 8, MORE_STORIES = 40;      // the feed is the top stories only: fetch the rest when you get this close to its end
const FLASH_MS = 3000;
const FIND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const CHECK_FEED_MS = 2 * 60000;

const $ = (s, el = document) => el.querySelector(s);
const feedEl = $('#feed'), wrap = $('#player-wrap'), gesture = $('#gesture'), topicsEl = $('#topics');
const hintEl = $('#hint'), statusEl = $('#status'), newPill = $('#new-pill');
const consentEl = $('#consent'), settingsEl = $('#settings');

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
    box.append(el('p', 'small', 'Watch a few clips and you\u2019ll see how much of each side you\u2019ve watched this week. Only this device knows.'));
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
  box.append(el('p', 'small', 'Clips you\u2019ve watched in the last 7 days. Only this device knows.'));
  const least = Object.keys(totals).reduce((a, b) => (totals[b] < totals[a] ? b : a));
  if (sum >= 5 && settings.side !== least) {
    const b = el('button', 'mix-try', `Open stories on ${COLUMNS[least]} for a while`);
    b.onclick = () => {
      settings.side = least;
      side = least;
      store.set('settings', settings);
      b.replaceWith(el('p', 'small', `Stories will open on ${COLUMNS[least]} when they have it. Change this in Settings.`));
    };
    box.append(b);
  }
}

// ---------------------------------------------------------------- state
let feed = null, stories = [];
let activeS = -1, activeC = -1, currentId = null;
let player = null, playerReady = false, unlocked = false, playing = false, playerStarted = false;
let topic = TOPICS[store.get('topic', 'all')] ? store.get('topic', 'all') : 'all';
let query = '', everything = null;
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

function renderTopics() {
  topicsEl.textContent = '';
  const strip = el('div', 'strip');
  const daily = el('button', 'daily-tab' + (dailyDone() ? '' : ' fresh'), 'Blind Pick');
  if (!dailyDone()) daily.setAttribute('aria-label', 'Blind Pick, new pairs today');
  daily.onclick = openDaily;
  strip.append(daily);
  for (const [key, label] of Object.entries(TOPICS)) {
    const b = el('button', key === topic ? 'on' : '', label);
    b.setAttribute('aria-pressed', key === topic);
    b.onclick = () => {
      if (key === topic) return;
      topic = key;
      store.set('topic', key);
      renderTopics();
      if (feed) { onScrollStart(); start(); }
    };
    strip.append(b);
  }
  const find = el('button', 'find');
  find.innerHTML = FIND_ICON;
  find.setAttribute('aria-label', 'Search stories');
  find.onclick = renderSearch;
  const gear = el('button', 'gear');
  gear.innerHTML = SETTINGS_ICON;
  gear.setAttribute('aria-label', 'Settings');
  gear.onclick = openSettings;
  const refresh = el('button', 'refresh');
  refresh.innerHTML = REFRESH_ICON;
  refresh.setAttribute('aria-label', 'Check for new stories');
  refresh.onclick = refreshFeed;
  topicsEl.append(strip, refresh, find, gear);
  strip.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderSearch() {
  topicsEl.textContent = '';
  const form = el('form', 'search');
  form.setAttribute('role', 'search');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Search a topic';
  input.enterKeyHint = 'search';
  input.setAttribute('aria-label', 'Search a topic');
  input.autocomplete = 'off';
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => {
    const had = query;
    query = '';
    renderTopics();
    if (had && feed) { onScrollStart(); start(); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    input.blur();
    query = input.value.trim();
    if (!query || !feed) return;
    onScrollStart();
    setStatus('Searching…');
    feedEl.textContent = '';
    everything = everything || await loadEverything();
    start();
  };
  form.append(input, cancel);
  topicsEl.append(form);
  input.focus();
}

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

    const tabs = el('nav', 'tabs');
    tabs.setAttribute('aria-label', 'Political lean of the outlets covering this story');
    for (const [col, label] of Object.entries(COLUMNS)) {
      if (!s.sides[col] || s.topic === 'sports') continue;     // left and right mean nothing for sport
      const b = el('button', '', label);
      b.dataset.column = col;
      b.onclick = () => jumpToColumn(si, col);
      tabs.append(b);
    }
    if (s.blindspot) tabs.append(el('span', 'blind', `No ${s.blindspot} coverage`));

    const clips = el('div', 'clips');
    const ticks = el('div', 'ticks');
    s.clips.forEach((c) => {
      const clip = el('article', 'clip');
      const slot = el('div', 'slot');
      if (videosOn()) {
        const img = el('img');
        img.loading = si < 3 ? 'eager' : 'lazy';
        img.alt = '';
        img.src = `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`;
        slot.append(img, el('div', 'msg'));
      } else {
        const off = el('div', 'off');
        const open = el('a', '', 'Watch on YouTube');
        open.href = `https://www.youtube.com/watch?v=${c.id}`; open.target = '_blank'; open.rel = 'noopener';
        const on = el('button', '', 'Turn on videos');
        on.onclick = openSettings;
        off.append(el('span', '', 'Videos are off'), open, on);
        slot.append(off);
      }

      const meta = el('div', 'meta');
      const row = el('div', 'row');
      const src = el('span', 'src');
      src.append(el('b', '', c.channel), ` · ${c.country ? `${c.country} · ` : ''}${ago(c.published)}`);
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
    if (s.topic !== 'sports') sec.append(tabs);
    sec.append(ticks, clips);
    feedEl.append(sec);
    markPosition(si, 0);
}

function showEnd() {
  ended = true;
  const sec = el('section', 'story end');
  sec.append(el('p', '', query ? 'That\u2019s every match from the last two days.' : 'That\u2019s everything from the last two days.'));
  const b = el('button', '', 'Check for new stories');
  b.onclick = refreshFeed;
  sec.append(b);
  feedEl.append(sec);
}

const inTopic = (s) => (topic === 'all' ? settings.sportsInAll || s.topic !== 'sports' : (s.tags || []).includes(topic));

async function loadMore() {
  if (query || ended || loadingMore || !stories.length) return;
  loadingMore = true;
  const run = startRun;
  everything = everything || await loadEverything();
  loadingMore = false;
  if (run !== startRun) return;
  if (!reserve) {
    const shown = new Set(stories.flatMap((s) => s.clips.map((c) => c.id)));
    reserve = orderStories(everything.filter(inTopic)).filter((s) => !s.clips.some((c) => shown.has(c.id)));
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
  sec.querySelectorAll('.tabs button').forEach((b) => {
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
  if (!stories.length || LANDSCAPE.matches) return;   // rotating moves the scroll position: keep the clip we were on
  if (ended && Math.round(feedEl.scrollTop / (feedEl.clientHeight || 1)) >= stories.length) {    // on the end screen
    if (playerReady) player.pauseVideo();
    wrap.hidden = gesture.hidden = true;
    return;
  }
  const [s, c] = current();
  if (s !== activeS) {          // a new story opens on the side you were watching, if it has that side
    const ci = stories[s].clips.findIndex((k) => k.column === side);
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
  activate(s, c);
  if (s >= stories.length - MORE_AT) loadMore();
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
  if (dt < 400 && playerReady) playing ? player.pauseVideo() : player.playVideo();
});
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
window.addEventListener('resize', () => { if (activeS >= 0) placePlayer(activeS, activeC); });

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

// ---------------------------------------------------------------- consent + settings
function chooseVideos(on) {
  consent = on ? 'videos' : 'text';
  store.set('consent', consent);
}
$('#consent-videos').onclick = () => { chooseVideos(true); consentEl.close(); if (feed) start(); };
$('#consent-text').onclick = () => { chooseVideos(false); consentEl.close(); if (feed) start(); };
consentEl.addEventListener('cancel', (e) => e.preventDefault());      // a real choice, either way

let settingsChanged = false;
const toggles = ['auto', 'hideWatched', 'sportsInAll', 'notes'];
function saveSettings() {
  store.set('settings', settings);
  settingsChanged = true;
}
function openSettings() {
  if (playerReady) player.pauseVideo();
  $('#set-videos').checked = videosOn();
  $('#set-side').value = settings.side;
  for (const t of toggles) $(`#set-${t}`).checked = settings[t];
  $('#set-clear').textContent = 'Clear watched history';
  $('#set-blind').textContent = 'Clear my Blind Pick results';
  renderMix($('#settings-mix'));
  settingsEl.showModal();
}
for (const t of toggles) {
  $(`#set-${t}`).onchange = (e) => { settings[t] = e.target.checked; saveSettings(); };
}
$('#set-side').onchange = (e) => { settings.side = e.target.value; side = settings.side || null; saveSettings(); };
$('#set-videos').onchange = (e) => {
  chooseVideos(e.target.checked);
  if (e.target.checked) settingsChanged = true;
  else location.reload();     // the only way to fully take the YouTube player back out of the page
};
$('#set-clear').onclick = (e) => {
  watched = new Set();
  store.set('watched', []);
  settingsChanged = true;
  e.target.textContent = 'Cleared';
};
$('#set-blind').onclick = (e) => {
  store.set('blind', { said: '', picks: [] });
  e.target.textContent = 'Cleared';
};
$('#set-reset').onclick = () => {
  try { localStorage.clear(); } catch { /* private mode etc. */ }
  location.reload();
};
$('#settings-done').onclick = () => settingsEl.close();
settingsEl.addEventListener('close', () => {
  if (!feed) return;
  if (settingsChanged) { settingsChanged = false; onScrollStart(); start(); } else settle();
});

// ---------------------------------------------------------------- compare
const openSheet = (d) => { if (playerReady) player.pauseVideo(); d.showModal(); };
for (const d of [$('#daily'), $('#compare')]) {
  d.querySelector('.done').onclick = () => d.close();
  d.addEventListener('close', () => { if (feed) settle(); });
}

function openCompare(si, currentClip) {
  const s = stories[si], box = $('#compare-body');
  box.textContent = '';
  if (s.blindspot) box.append(el('p', 'small', `No ${s.blindspot} coverage among the outlets in this app.`));
  for (const [col, label] of Object.entries(COLUMNS)) {
    const clips = s.clips.filter((c) => c.column === col);
    if (!clips.length) continue;
    if (s.topic !== 'sports') box.append(el('h3', 'set-heading', label));     // left and right mean nothing for sport
    for (const c of clips) {
      const b = el('button', 'headline' + (c.id === currentClip ? ' now' : ''));
      b.append(el('span', 'headline-title', c.title), el('span', 'small', `${c.channel} \u00b7 ${c.country ? `${c.country} \u00b7 ` : ''}${ago(c.published)}`));
      b.onclick = () => {
        const ci = s.clips.indexOf(c), sc = clipsEl(si);
        $('#compare').close();
        sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
      };
      box.append(b);
    }
  }
  const yt = el('a', 'set-link', 'Watch this clip on YouTube');
  yt.href = `https://www.youtube.com/watch?v=${currentClip}`; yt.target = '_blank'; yt.rel = 'noopener';
  box.append(yt, el('p', 'small', 'Headlines from YouTube videos. Sides are outlet ratings from Media Bias/Fact Check, not judgements of these headlines.'));
  openSheet($('#compare'));
}

// ---------------------------------------------------------------- blind pick
// Two headlines on one event, outlets hidden: which would you trust more? No right answer, no score, nothing about watching.
// Together the picks hint at someone's politics, so they stay on this device and are never sent anywhere.
let dailyData = null;
const dailyState = () => store.get('dailyGame', {});
const blindState = () => store.get('blind', { said: '', picks: [] });
function dailyDone() {
  const g = dailyState();
  return g.date === dayKey() && g.finished;
}
async function openDaily() {
  const box = $('#daily-body');
  box.textContent = '';
  box.append(el('p', 'small', 'Loading\u2026'));
  openSheet($('#daily'));
  try {
    const r = await fetch(`${FEED_URL.replace('feed.json', 'daily.json')}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`daily ${r.status}`);
    dailyData = await r.json();
  } catch {
    box.textContent = '';
    box.append(el('p', '', 'Couldn\u2019t load today\u2019s pairs. Check your connection.'));
    return;
  }
  if (!dailyData.rounds || dailyData.rounds.length < 3) {
    box.textContent = '';
    box.append(el('p', '', 'Today\u2019s pairs aren\u2019t ready yet. Try again later.'));
    return;
  }
  if (dailyState().date !== dailyData.date) store.set('dailyGame', { date: dailyData.date, picks: [] });
  renderDaily();
}

function askLean(box) {
  box.append(el('p', 'daily-q', 'Before you start: where do you think you lean?'));
  box.append(el('p', 'small', 'Your picks get compared with this later. It stays on this device.'));
  for (const [value, label] of [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['unsure', 'Not sure, or I\u2019d rather not say']]) {
    const b = el('button', 'pick short', label);
    b.onclick = () => {
      store.set('blind', { ...blindState(), said: value });
      renderDaily();
    };
    box.append(b);
  }
}

function renderDaily() {
  const box = $('#daily-body'), g = dailyState(), rounds = dailyData.rounds, i = g.picks.length;
  box.textContent = '';
  if (!blindState().said) return askLean(box);
  if (i >= rounds.length) return renderDailyResult();
  const r = rounds[i];
  box.append(el('p', 'small', `Pair ${i + 1} of ${rounds.length}`));
  box.append(el('p', 'daily-q', 'Same event, outlets hidden. Which headline would you trust more?'));
  r.clips.forEach((c, pick) => {
    const b = el('button', 'pick', c.title);
    b.onclick = () => {
      const state = dailyState();
      state.picks.push(pick);
      store.set('dailyGame', state);
      const blind = blindState();
      blind.picks = [...blind.picks, c.column].slice(-BLIND_KEEP);
      store.set('blind', blind);
      revealDaily(i);
    };
    box.append(b);
  });
}

function revealDaily(i) {
  const box = $('#daily-body'), g = dailyState(), r = dailyData.rounds[i];
  box.textContent = '';
  box.append(el('p', 'small', `Pair ${i + 1} of ${dailyData.rounds.length}`));
  box.append(el('p', 'daily-q', 'Here\u2019s who wrote what.'));
  r.clips.forEach((c, n) => {
    const card = el('div', 'pick shown' + (n === g.picks[i] ? ' chosen' : ''));
    card.append(el('span', 'headline-title', c.title), el('span', 'small', `${c.channel} \u00b7 ${c.country} \u00b7 ${SIDE_LABEL[c.column]}${n === g.picks[i] ? ' \u00b7 your pick' : ''}`));
    box.append(card);
  });
  const last = i + 1 >= dailyData.rounds.length;
  const next = el('button', 'daily-next', last ? 'See your reading' : 'Next');
  next.onclick = renderDaily;
  box.append(next);
}

function renderReading(box) {
  const { said, picks } = blindState();
  const right = picks.filter((c) => c === 'right').length, n = picks.length;
  if (n < BLIND_FIRST_READING) {
    box.append(el('p', 'daily-q', `${BLIND_FIRST_READING - n} more pick${BLIND_FIRST_READING - n === 1 ? '' : 's'} until your first reading.`));
    return;
  }
  const meter = el('div', 'meter');
  const marker = el('i');
  marker.style.left = `${Math.round((right / n) * 100)}%`;
  meter.append(marker);
  const ends = el('div', 'meter-ends');
  ends.append(el('span', '', 'Trusted left-leaning'), el('span', '', 'Trusted right-leaning'));
  const line = `Blind, you trusted the right-leaning headline ${right} of ${n} times.`;
  const youSaid = COLUMNS[said] ? ` You said you lean ${COLUMNS[said]}.` : '';
  box.append(el('p', 'daily-q', line + youSaid), meter, ends);
  box.append(el('p', 'small', `${n < BLIND_SETTLED ? 'An early reading from just a few headlines. ' : ''}This is about how headlines read to you, not what you believe, and tone can sway it as much as politics. Sides are outlet ratings from Media Bias/Fact Check.`));
}

function renderDailyResult() {
  const box = $('#daily-body'), g = dailyState();
  if (!g.finished) {
    g.finished = true;
    store.set('dailyGame', g);
    renderTopics();
  }
  const { picks } = blindState(), right = picks.filter((c) => c === 'right').length;
  renderReading(box);
  box.append(el('p', 'small', 'New pairs tomorrow, and your reading will shift as they come in.'));
  const share = el('button', 'daily-next', 'Challenge a friend');
  share.onclick = async () => {
    const text = picks.length >= BLIND_FIRST_READING
      ? `With the outlets hidden, I trusted the right-leaning headline ${right} of ${picks.length} times. What would you pick?`
      : 'Two headlines, outlets hidden. Which would you trust? You might be surprised who wrote it.';
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      share.textContent = 'Copied';
    } catch { /* they closed the share sheet */ }
  };
  box.append(share, el('h3', 'set-heading', 'What you actually watch'));
  const mix = el('div');
  renderMix(mix);
  box.append(mix, el('p', 'small', 'Headlines from YouTube videos.'));
}

function start() {
  startRun++;
  reserve = null;
  ended = false;
  if (query) {
    stories = orderStories(matches(everything || feed.stories || [], query));
  } else {
    // Watched stories wait until the end, so they never sit in front of ones you haven't seen.
    const pool = (feed.stories || []).filter(inTopic);
    let fresh = orderStories(pool).filter((s) => !s._seen);
    if (!fresh.length) {       // nothing left in the top stories for this tab: look through all of them
      if (!everything) {
        const run = startRun;
        setStatus('Loading\u2026');
        loadEverything().then((all) => { everything = all; if (run === startRun) start(); });
        return;
      }
      const all = orderStories(everything.filter(inTopic));
      fresh = all.filter((s) => !s._seen).slice(0, MORE_STORIES);
      if (!fresh.length) fresh = settings.hideWatched ? [] : all;
    }
    stories = fresh;
  }
  currentId = null;
  activeS = -1;
  if (!stories.length) {
    feedEl.textContent = '';
    wrap.hidden = gesture.hidden = true;
    scrolling = false;
    if (query) { setStatus(`Nothing about "${query}" in the last two days.`); return; }
    setStatus(topic === 'all' ? 'No stories right now. Check back soon.' : `No ${TOPICS[topic].toLowerCase()} stories right now.`);
    return;
  }
  setStatus('');
  render();
  if (query) showEnd();
  feedEl.scrollTop = 0;
  if (playerStarted || !videosOn()) { settle(); return; }
  playerStarted = true;
  createPlayer(stories[0].clips[0].id);
}

(async function boot() {
  renderTopics();
  try {
    feed = await loadFeed();
  } catch (e) {
    setStatus('Couldn’t load the feed. Check your connection.', true);
    return;
  }
  start();
  if (!consent) consentEl.showModal();
})();
