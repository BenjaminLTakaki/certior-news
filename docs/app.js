// Swipe News — one story per screen. Swipe up/down = next/previous story,
// swipe left/right = the same story from Left, Center and Right outlets around the world.
// One YouTube player is reused for every clip and laid over the active clip's video area.

const params = new URLSearchParams(location.search);
const FEED_URL = params.get('feed') || 'feed.json';
const TOPICS = { all: 'All', politics: 'Politics', sports: 'Sports' };
const COLUMNS = { left: 'Left', center: 'Center', right: 'Right', unrated: 'Not rated' };
const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/>${path}</svg>`;
const SOUND_ON = icon('<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
const SOUND_OFF = icon('<path d="m16 9.5 5 5m0-5-5 5"/>');
const PLAY_CHECK_MS = 1800;   // if a clip isn't playing after this, ask for a tap
const WATCHED_AFTER_MS = 3000;
const CHECK_FEED_MS = 2 * 60000;

const $ = (s, el = document) => el.querySelector(s);
const feedEl = $('#feed'), wrap = $('#player-wrap'), gesture = $('#gesture'), topicsEl = $('#topics');
const hintEl = $('#hint'), statusEl = $('#status'), newPill = $('#new-pill');

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
let watched = new Set(store.get('watched', []));
function markWatched(id) {
  if (watched.has(id)) return;
  watched.add(id);
  store.set('watched', [...watched].slice(-3000));
}

// ---------------------------------------------------------------- state
let feed = null, stories = [];
let activeS = -1, activeC = -1, currentId = null;
let player = null, playerReady = false, unlocked = false, playing = false, playerStarted = false;
let topic = TOPICS[store.get('topic', 'all')] ? store.get('topic', 'all') : 'all';
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
    topicsEl.append(b);
  }
}

function orderStories(list) {
  // unseen stories first (feed order = ranking), fully watched ones at the end
  const seen = (s) => s.clips.every((c) => watched.has(c.id));
  return [...list.filter((s) => !seen(s)), ...list.filter(seen).map((s) => ({ ...s, _seen: true }))];
}

function render() {
  feedEl.textContent = '';
  stories.forEach((s, si) => {
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
      const img = el('img');
      img.loading = si < 3 ? 'eager' : 'lazy';
      img.alt = '';
      img.src = `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`;
      slot.append(img, el('div', 'msg'));

      const meta = el('div', 'meta');
      const row = el('div', 'row');
      const src = el('span', 'src');
      src.append(el('b', '', c.channel), ` · ${c.country ? `${c.country} · ` : ''}${ago(c.published)}`);
      const snd = el('button', 'snd');
      snd.innerHTML = SOUND_ON; snd.setAttribute('aria-label', 'Sound on or off'); snd.onclick = toggleMute;
      const yt = el('a', '', 'YouTube');
      yt.href = `https://www.youtube.com/watch?v=${c.id}`; yt.target = '_blank'; yt.rel = 'noopener';
      row.append(src, snd, yt);
      meta.append(el('h2', 'ctitle', c.title));
      if (c.note) meta.append(el('p', 'note', c.note));    // YouTube's box in the player cuts this off, and we can't change it
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
  });
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
  const t = Math.max(0, Math.min(stories.length - 1, s + d));
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
  if (!stories.length) return;
  const [s, c] = current();
  activate(s, c);
}

function activate(s, c) {
  const clip = stories[s].clips[c];
  markPosition(s, c);
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
  for (const e of [wrap, gesture]) Object.assign(e.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
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
    clearTimeout(watchTimer);
    const id = currentId;
    watchTimer = setTimeout(() => markWatched(id), WATCHED_AFTER_MS);
    updateMuteIcons();
  }
  if (e.data === S.ENDED) { markWatched(currentId); goClip(1); }
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
  setTimeout(() => { if (currentId === id) goClip(1); }, 2500);
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
      onReady: () => { playerReady = true; const [s, c] = current(); activate(s, c); },
      onStateChange: onState,
      onError,
    },
  });
}

// ---------------------------------------------------------------- gestures on top of the video
let g0 = null;
gesture.addEventListener('pointerdown', (e) => {
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

function start() {
  stories = orderStories((feed.stories || []).filter((s) => topic === 'all' || s.topic === topic));
  currentId = null;
  if (!stories.length) {
    feedEl.textContent = '';
    wrap.hidden = gesture.hidden = true;
    activeS = -1;
    scrolling = false;
    setStatus(topic === 'all' ? 'No stories right now. Check back soon.' : `No ${TOPICS[topic].toLowerCase()} stories right now.`);
    return;
  }
  setStatus('');
  render();
  feedEl.scrollTop = 0;
  if (playerStarted) { settle(); return; }
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
})();
