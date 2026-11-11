// Certior: the YouTube player, and the gestures, keys and wheel on top of the video.
import { $, DOUBLE_TAP_MS, DRAG_COMMIT, DRAG_START, FLICK_PX_MS, PLAY_CHECK_MS, S, SKIP_S, SMOOTH, SOUND_OFF, SOUND_ON, WATCHED_AFTER_MS, el, feedEl, gesture, here, markWatched, showHint, wrap } from './shared.js';
import { advance, clipsEl, current, flash, goStory, hint, hintSideways, inFeedView, settle, start, storyEl } from './feed.js';
import { WIDE, openCompare } from './compare.js';

// ---------------------------------------------------------------- player
export function armPlayCheck() {
  clearTimeout(S.playCheck);
  if (!S.unlocked) { hint('Tap the video to start'); return; }
  S.playCheck = setTimeout(() => {
    if (!S.playing) {               // iOS refused to start: hand the next tap to the player itself
      gesture.hidden = true;
      hint('Tap the video to play');
    }
  }, PLAY_CHECK_MS);
}

export const progressFill = $('#progress i');
export let progressTimer = 0;
export function showProgress(at) { progressFill.style.transform = `scaleX(${at})`; }
export function trackProgress() {
  clearInterval(progressTimer);
  const tick = () => { const d = S.player.getDuration() || 0; showProgress(d ? Math.min(1, S.player.getCurrentTime() / d) : 0); };
  tick();
  if (S.playing) progressTimer = setInterval(tick, 250);
}

export function onState(e) {
  const S = window.YT.PlayerState;
  S.playing = e.data === S.PLAYING;
  trackProgress();
  if (S.playing) {
    if (!S.unlocked) { S.unlocked = true; }
    if (document.activeElement?.tagName === 'IFRAME') document.activeElement.blur();      // the first tap left the keyboard inside YouTube's player
    gesture.hidden = false;
    showHint('');
    hintSideways();
    clearTimeout(S.watchTimer);
    const id = S.currentId;
    S.watchTimer = setTimeout(() => markWatched(id), WATCHED_AFTER_MS);
    updateMuteIcons();
  }
  if (e.data === S.ENDED) {
    markWatched(S.currentId);
    S.player.seekTo(0, true);       // plays again until you swipe
    S.player.playVideo();
  }
}

export function onError() {
  const id = S.currentId;
  const clipEl = storyEl(S.activeS)?.querySelectorAll('.clip')[S.activeC];
  if (clipEl) {
    clipEl.classList.add('err');
    const msg = clipEl.querySelector('.msg');
    msg.innerHTML = '';
    const a = el('a', '', 'Open in YouTube'); a.href = `https://www.youtube.com/watch?v=${id}`; a.target = '_blank';
    msg.append('This clip can’t play inside the app. ', a);
  }
  wrap.classList.add('away');
  gesture.hidden = false;
  setTimeout(() => { if (S.currentId === id) advance(); }, 2500);
}

export function toggleMute() {
  if (!S.playerReady) return;
  S.player.isMuted() ? S.player.unMute() : S.player.mute();
  setTimeout(updateMuteIcons, 100);
}
export function updateMuteIcons() {
  if (!S.playerReady) return;
  const svg = S.player.isMuted() ? SOUND_OFF : SOUND_ON;
  document.querySelectorAll('.snd').forEach((b) => { b.innerHTML = svg; });
}

export function loadYouTubeApi() {
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    // YouTube can't be reached (a school or office network, a content blocker, no connection): the stories as text for
    // this visit. Not saved, so the next visit tries the videos again.
    // ponytail: only the first script is watched; add a timeout on onReady if the player's own files turn out to fail too
    s.onerror = () => {
      S.consent = 'text'; S.playerStarted = false;
      document.documentElement.classList.remove('videos');
      if (S.feed) start(here());
      flash('Videos can’t load: showing text.');
    };
    document.head.appendChild(s);
  });
}

export async function createPlayer(firstId) {
  await loadYouTubeApi();
  S.player = new window.YT.Player('player', {
    width: '100%', height: '100%', videoId: firstId,
    playerVars: { playsinline: 1, controls: 0, rel: 0, fs: 0, iv_load_policy: 3, disablekb: 1, origin: location.origin },
    events: {
      onReady: () => { S.playerReady = true; settle(); },
      onStateChange: onState,
      onError,
    },
  });
}

// ---------------------------------------------------------------- gestures on top of the video
// g0: the touch in progress. axis: 'y' (stories) or 'x' (outlets) once it moved DRAG_START, else still a possible tap.
export let g0 = null;
export const dragged = (g) => (g.axis === 'y' ? feedEl : clipsEl(g.s));
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
export function letGo(g, d, dt) {
  const el = dragged(g), size = g.axis === 'y' ? el.clientHeight : el.clientWidth;
  const from = g.axis === 'y' ? g.s : Math.round(g.left / size);
  const step = Math.abs(d) > size * DRAG_COMMIT || Math.abs(d) / Math.max(dt, 1) > FLICK_PX_MS ? (d < 0 ? 1 : -1) : 0;
  const last = g.axis === 'y' ? feedEl.children.length - 1 : S.stories[g.s].clips.length - 1;
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
  if (dt >= 400 || !S.playerReady) return;
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
  tapTimer = setTimeout(() => { lastTap = 0; S.playing ? S.player.pauseVideo() : S.player.playVideo(); }, DOUBLE_TAP_MS);
});
export let lastTap = 0, tapTimer = 0, skipTimer = 0;
export function skip(d) {
  const end = S.player.getDuration() || 0;
  S.player.seekTo(Math.max(0, Math.min(end ? end - 1 : Infinity, S.player.getCurrentTime() + d)), true);
  const f = $('#skip');
  f.textContent = d < 0 ? `−${-d} s` : `+${d} s`;
  f.className = d < 0 ? 'back on' : 'on';
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => f.classList.remove('on'), 600);
}
gesture.addEventListener('pointercancel', () => { const g = g0; g0 = null; if (g?.axis) letGo(g, 0, 1e9); });     // spring back
// Without this, Chromium treats a flick here as a fling and swallows the next tap anywhere on the page.
gesture.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

// ---------------------------------------------------------------- keyboard and mouse wheel: a laptop has no swipe
export function sideways(d) {
  const sc = clipsEl(S.activeS);
  if (sc) sc.scrollTo({ left: (S.activeC + d) * sc.clientWidth, behavior: SMOOTH });
}
document.addEventListener('keydown', (e) => {
  const s = S.stories[S.activeS], k = e.key.toLowerCase();
  if (!s || !inFeedView() || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.closest?.('input, select, textarea')) return;
  if (k === 'arrowdown') goStory(1);
  else if (k === 'arrowup') goStory(-1);
  else if (k === 'arrowright') sideways(1);
  else if (k === 'arrowleft') sideways(-1);
  else if (k === 'c' && s.clips.length > 1 && !WIDE.matches) openCompare(S.activeS, s.clips[S.activeC].id);
  else if (k === 'm' && S.playerReady) toggleMute();
  else if (k === ' ' && S.playerReady && !e.target.closest?.('button, a')) S.playing ? S.player.pauseVideo() : S.player.playVideo();
  else return;
  e.preventDefault();
});
// The layer over the video isn't inside the feed, so a wheel or trackpad there wouldn't scroll it.
export const WHEEL_GAP_MS = 900;      // one step per flick: a trackpad keeps sending the same flick for a while
export let wheelAt = 0;
gesture.addEventListener('wheel', (e) => {
  if (Date.now() - wheelAt < WHEEL_GAP_MS) return;
  wheelAt = Date.now();
  if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) goStory(Math.sign(e.deltaY)); else sideways(Math.sign(e.deltaX));
}, { passive: true });
