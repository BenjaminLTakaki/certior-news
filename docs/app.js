// Swipe News — one story per screen. Swipe up/down = next/previous story,
// swipe left/right = the same story from Left -> Center -> Right outlets.
// One YouTube player is reused for every clip and laid over the active clip's video area.

const params = new URLSearchParams(location.search);
const FEED_URL = params.get('feed') || 'feed.json';
const COL_LABEL = { left: 'Left', center: 'Center', right: 'Right' };
const PLAY_CHECK_MS = 1800;   // if a clip isn't playing after this, ask for a tap
const WATCHED_AFTER_MS = 3000;

const $ = (s, el = document) => el.querySelector(s);
const feedEl = $('#feed'), wrap = $('#player-wrap'), gesture = $('#gesture');
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
let player = null, playerReady = false, unlocked = false, playing = false;
let playCheck = 0, watchTimer = 0, loadedAt = Date.now();

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
function setAppHeight() { document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`); }

// ---------------------------------------------------------------- feed
async function loadFeed() {
  const r = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`feed ${r.status}`);
  return r.json();
}

function orderStories(list) {
  // unseen stories first (feed order = ranking), fully watched ones at the end
  const seen = (s) => s.clips.every((c) => watched.has(c.id));
  return [...list.filter((s) => !seen(s)), ...list.filter(seen).map((s) => ({ ...s, _seen: true }))];
}

function render() {
  feedEl.textContent = '';
  stories.forEach((s, si) => {
    const sec = el('section', 'story' + (s._seen ? ' seen' : ''));
    sec.dataset.i = si;

    const head = el('div', 'head');
    const cov = el('div', 'cov');
    for (const col of ['left', 'center', 'right']) {
      const n = s.coverage[col];
      const b = el('button', col, `${COL_LABEL[col]} ${n}`);
      b.dataset.n = n; b.style.flexGrow = n;
      b.onclick = () => jumpToColumn(si, col);
      cov.append(b);
    }
    const badges = el('div', 'badges');
    if (s.blindspot) badges.append(el('span', 'badge blind', `Blindspot: no ${COL_LABEL[s.blindspot]} coverage`));
    if (s.single) badges.append(el('span', 'badge', 'Single source'));
    if (s._seen) badges.append(el('span', 'badge', 'Seen'));
    badges.append(el('span', 'badge', ago(s.updated)));
    head.append(cov, el('h2', '', s.headline), badges);

    const clips = el('div', 'clips');
    const dots = el('div', 'dots');
    s.clips.forEach((c, ci) => {
      const clip = el('article', 'clip');
      clip.dataset.col = c.column;
      const slot = el('div', 'slot');
      const img = el('img');
      img.loading = si < 3 ? 'eager' : 'lazy';
      img.alt = '';
      img.src = `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`;
      const msg = el('div', 'msg');
      slot.append(img, el('div', 'edge'), msg);

      const meta = el('div', 'meta');
      const row = el('div', 'row');
      const yt = el('a', '', 'YouTube ↗');
      yt.href = `https://www.youtube.com/watch?v=${c.id}`; yt.target = '_blank'; yt.rel = 'noopener';
      const snd = el('button', 'snd', '🔈'); snd.title = 'Sound on/off'; snd.onclick = toggleMute;
      row.append(el('span', 'outlet', c.channel), el('span', `pill ${c.column}`, c.column), el('span', '', ago(c.published)), snd, yt);
      meta.append(row, el('p', 'ctitle', c.title));
      clip.append(slot, meta);
      clips.append(clip);
      dots.append(el('i', c.column));
    });
    let t = 0;
    clips.addEventListener('scroll', () => { onScrollStart(); clearTimeout(t); t = setTimeout(settle, 140); }, { passive: true });
    sec.append(head, clips, dots);
    feedEl.append(sec);
  });
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
  feedEl.scrollTo({ top: t * feedEl.clientHeight, behavior: 'smooth' });
}
function goClip(d) {
  const [s, c] = current();
  const sc = clipsEl(s);
  const n = stories[s].clips.length;
  if (c + d >= n && d > 0) return goStory(1);          // past the last side -> next story
  sc.scrollTo({ left: Math.max(0, Math.min(n - 1, c + d)) * sc.clientWidth, behavior: 'smooth' });
}
function jumpToColumn(si, col) {
  const ci = stories[si].clips.findIndex((c) => c.column === col);
  const sc = clipsEl(si);
  if (ci >= 0 && sc) sc.scrollTo({ left: ci * sc.clientWidth, behavior: 'smooth' });
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
  [...storyEl(s).querySelectorAll('.dots i')].forEach((d, i) => d.classList.toggle('on', i === c));
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
  const icon = player.isMuted() ? '🔇' : '🔈';
  document.querySelectorAll('.snd').forEach((b) => { b.textContent = icon; });
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

// ---------------------------------------------------------------- boot
let feedTimer = 0;
feedEl.addEventListener('scroll', () => { onScrollStart(); clearTimeout(feedTimer); feedTimer = setTimeout(settle, 140); }, { passive: true });
window.addEventListener('resize', () => { setAppHeight(); if (activeS >= 0) placePlayer(activeS, activeC); });

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !feed) return;
  if (Date.now() - loadedAt < 5 * 60000) return;
  try {
    const fresh = await loadFeed();
    if (fresh.generated !== feed.generated) {
      newPill.hidden = false;
      newPill.onclick = () => { newPill.hidden = true; feed = fresh; loadedAt = Date.now(); start(false); };
    }
  } catch { /* offline: keep what we have */ }
});

function start(withPlayer) {
  stories = orderStories(feed.stories || []);
  if (!stories.length) {
    setStatus('No stories yet. Run the “Update feed” workflow on GitHub (Actions tab), then reopen the app.');
    return;
  }
  setStatus('');
  render();
  feedEl.scrollTop = 0;
  currentId = null;
  if (withPlayer) createPlayer(stories[0].clips[0].id);
  else settle();
}

(async function boot() {
  setAppHeight();
  try {
    feed = await loadFeed();
  } catch (e) {
    setStatus('Couldn’t load the feed. Check your connection.', true);
    return;
  }
  start(true);
})();
