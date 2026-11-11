// Certior: the feed. Loading it, drawing the stories, moving between them, the tabs, and checking for new stories.
import { $, CHECK_FEED_MS, COLUMNS, COUNTRY, DRAG_START, FEED_URL, FLASH_MS, GESTURE_HEIGHT, GESTURE_TOP, LANDSCAPE, MORE_AT, MORE_STORIES, REFRESH_ICON, S, SHUFFLE_ICON, SIDES, SIDEWAYS_HINT, SMOOTH, SOUND_ON, TOPICS, ago, backToFeed, byline, count, el, feedEl, gesture, here, hintEl, openSide, pushed, setStatus, settings, showHint, store, videosOn, welcomeEl, wrap } from './shared.js';
import { armPlayCheck, createPlayer, g0, showProgress, toggleMute } from './player.js';
import { loadEverything, matches, orderStories, renderRecent, runSearch, showResults } from './search.js';
import { renderRecap, sideHeads, updateBadge } from './recap.js';
import { placeList, renderWorld, takeMeSomewhere } from './world.js';
import { besideBody, openCompare, showBeside } from './compare.js';
import { syncSettings } from './settings.js';

// ---------------------------------------------------------------- feed
export const FEED_TIMEOUT_MS = 15000, NEWER_CHECK_MS = 6000;
export async function loadFeed() {
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
export const SIDE_RANK = { left: 0, center: 1, right: 2, state: 3 };
export function bySide(list) {
  for (const s of list) if (s.topic !== 'sports') s.clips.sort((a, b) => (SIDE_RANK[a.column] ?? 4) - (SIDE_RANK[b.column] ?? 4));
  return list;
}

export const inFeedView = () => !S.pageOpen;

export function renderBar() {
  const back = $('#back'), action = $('#bar-action'), select = $('#topic'), isPushed = pushed();
  back.hidden = !isPushed;
  back.textContent = S.place ? 'World' : S.searchFrom === 'recap' ? 'Recap' : 'Search';
  select.hidden = isPushed;
  $('#bar-chevron').toggleAttribute('hidden', isPushed);      // an svg has no .hidden property
  $('#bar-title').textContent = S.place ? `${COUNTRY[S.place]?.[1] ?? ''} ${COUNTRY[S.place]?.[0] ?? S.place}`.trim()
    : S.query ? `\u201C${S.query}\u201D` : S.pushedList ? S.pushedList.title : TOPICS[S.topic];
  select.value = S.topic;
  action.innerHTML = S.place ? SHUFFLE_ICON : REFRESH_ICON;
  action.setAttribute('aria-label', S.place ? 'Take me somewhere else' : newWaiting ? 'Show new stories' : 'Check for new stories');
  action.classList.toggle('new', newWaiting && !S.place);
  action.onclick = S.place ? takeMeSomewhere : refreshFeed;
  if (isPushed) $('#bar-end').prepend(action); else $('#bar-start').append(action);
}

$('#topic').append(...Object.entries(TOPICS).map(([key, label]) => { const o = el('option', '', label); o.value = key; return o; }));
$('#topic').onchange = (e) => {
  S.topic = e.target.value;
  store.set('topic', S.topic);
  renderBar();
  if (S.feed) { onScrollStart(); start(); }
};
$('#back').onclick = () => {
  const from = S.place ? 'world' : S.searchFrom;
  const at = backToFeed();
  renderBar();
  onScrollStart();
  S.pageOpen = true;      // the page comes back first, so nothing plays behind it while the feed rebuilds
  if (S.feed) start(at);
  show(from);
};

// ---------------------------------------------------------------- tabs
export function show(next, opts = {}) {
  S.tab = next;
  S.pageOpen = next !== 'news' && !opts.pushed;
  for (const b of document.querySelectorAll('#tabbar button')) {
    const on = b.dataset.tab === next;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const name of ['recap', 'world', 'search', 'settings']) $(`#page-${name}`).hidden = !(S.pageOpen && name === next);
  welcomeEl.inert = $('#beside').inert = S.pageOpen;      // the page covers the welcome card, and the list beside is for the feed: keep the keyboard off both
  if (S.pageOpen) {
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
  if (S.settingsChanged && S.feed) {      // which stories you see may have changed
    S.settingsChanged = S.redraw = false;
    onScrollStart();
    start(here());
  } else if (S.redraw && S.feed) {        // only how they're drawn
    S.redraw = false;
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
        S.pageOpen = false;
        onScrollStart();
        if (S.feed) start(at);
      } else if (S.tab === 'news') {
        feedEl.scrollTo({ top: 0, behavior: SMOOTH });
      }
      return show('news');
    }
    if (pushed()) {
      const at = backToFeed();
      renderBar();
      S.pageOpen = true;
      if (S.feed) start(at);
    }
    show(next);
  };
}
$('#search-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q && S.feed) runSearch(q);
};
$('#search-input').oninput = showResults;

export function render() {
  feedEl.textContent = '';
  S.stories.forEach(renderStory);
}

export function renderStory(s, si) {
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
      compare.append('Compare', el('b', '', String(s.clips.length)));
      compare.setAttribute('aria-label', `Compare ${s.clips.length} headlines`);
      compare.onclick = () => openCompare(si, c.id);
      const meta = el('div', 'meta'), row = el('div', 'row');
      if (videosOn()) {
        // no thumbnail behind the player: between clips, just the outlet's name
        slot.append(el('div', 'wait', c.channel), el('div', 'msg'));
        const snd = el('button', 'snd');
        snd.type = 'button';
        snd.innerHTML = SOUND_ON; snd.setAttribute('aria-label', 'Sound on or off'); snd.onclick = toggleMute;
        const src = el('span', 'src');
        // the flag, not the country's name, which cut the row off: an Indian outlet's "Right" is on a US scale, and this shows whose
        src.append(`${COUNTRY[c.country]?.[1] ?? ''} `.trimStart(), el('b', '', c.channel), ` · ${byline(c, s)}`);
        row.append(src, snd, s.clips.length > 1 ? compare : yt);
        // YouTube's player shows any funding notice itself (sometimes cut off; Compare has it in full)
        // a widescreen clip (the feed marks them) leaves room under it: the other sides' headlines go there
        const others = c.wide && othersBox(s, c, si), under = el('div', 'under');
        if (others) { clip.classList.add('wide'); under.append(others); }
        meta.append(el('h2', 'ctitle', c.title), ...(others ? [under] : []), row);
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
export function textCard(s, c, si) {
  const card = el('div', 'textcard'), body = el('div', 'tc-body'), sport = s.topic === 'sports';
  const by = el('p', 'tc-by');
  by.append(el('b', '', c.channel), ` · ${byline(c, s, true)}`);
  body.append(el('h2', 'tc-head', c.title), by);
  if (c.note && settings.notes) body.append(el('p', 'tc-note', c.note));
  const others = othersBox(s, c, si);
  if (others) body.append(others);
  card.append(body);
  return card;
}

// The first headline from each other side (and the first State-funded one), each a tap from its clip. Nothing if the story has no other side.
export function othersBox(s, c, si) {
  const sport = s.topic === 'sports';
  const others = sport ? s.clips.filter((k) => k.channel !== c.channel).slice(0, 2).map((k) => [null, k])
    : [...Object.entries(sideHeads(s)), ...[s.clips.find((k) => k.column === 'state')].filter(Boolean).map((k) => ['state', k])]
      .filter(([col]) => col !== c.column);
  if (!others.length) return null;
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
  return box;
}

// Whatever doesn't fit gives way, so nothing is ever cut off and the video keeps the same box on every clip:
// - a Text Only card drops its least important lines first: the funding note (Compare has it), then the
//   State-funded headline, then the other sides' headline text (their outlets stay, a tap away), then the other
//   sides altogether (Compare has them). Left, Center and Right always go together; anything still too tall scrolls.
// - the other sides under a widescreen video give way the same way, their label first. If they have to go altogether,
//   the video takes the whole box back, as on an upright clip.
// - a title too long for the room under the video gets smaller type.
// Done for the stories around the one you're on.
export const FIT_STEPS = ['.tc-note', '.under .tc-label', '.tc-other[data-column="state"]', '.tc-other-head', '.tc-others'];
export function fitCards(sec) {
  if (!sec || sec.dataset.fit) return;
  sec.dataset.fit = '1';
  const over = (list) => list.filter((b) => b.scrollHeight > b.clientHeight + 1);      // read them all, then change
  const cards = [...sec.querySelectorAll('.textcard, .under')];
  for (const step of FIT_STEPS) for (const b of over(cards)) for (const e of b.querySelectorAll(step)) e.style.display = 'none';
  for (const u of sec.querySelectorAll('.under')) if (u.firstChild.style.display === 'none') u.closest('.clip').classList.remove('wide');
  const metas = [...sec.querySelectorAll('.ctitle')].map((t) => t.parentElement);
  for (const size of ['long', 'longer']) for (const m of over(metas)) m.querySelector('.ctitle').classList.add(size);
}

// Hold the sides control (or slide along it): the dots grow, and the clip under your finger comes up.
// A tap jumps to the first clip of the side you tapped.
export const HOLD_MS = 250;
export function holdToPick(ticks, clips, si) {
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

export function showEnd() {
  S.ended = true;
  const sec = el('section', 'story end');
  sec.append(el('p', '', S.pushedList ? 'That’s every story in this list.' : S.query ? 'That\u2019s every match from the last two days.' : S.place ? `That\u2019s everything from ${COUNTRY[S.place]?.[0] ?? S.place} in the last two days.` : 'That\u2019s everything from the last two days.'));
  const b = el('button', 'filled', S.place ? 'Take Me Somewhere Else' : S.pushedList ? 'Back to Recap' : 'Check for New Stories');
  b.type = 'button';
  b.onclick = S.place ? takeMeSomewhere : S.pushedList ? () => $('#back').click() : refreshFeed;
  sec.append(b);
  feedEl.append(sec);
}

export const sourceList = () => (S.place ? placeList(S.everything, S.place) : S.everything.filter(inTopic));
// Inside a tab, don't let one outlet lead story after story: small tabs were mostly one Indian outlet.
export const SPREAD_GAP = 3;
export function spread(list) {
  if (S.topic === 'all' || S.place || S.query) return list;
  const lead = (s) => s.clips[0].channel, rest = [...list], out = [];
  while (rest.length) {
    const recent = out.slice(-SPREAD_GAP).map(lead);
    const i = rest.findIndex((s) => !recent.includes(lead(s)));
    out.push(...rest.splice(Math.max(0, i), 1));
  }
  return out;
}
export const inTopic = (s) => (S.topic === 'all' ? settings.sportsInAll || s.topic !== 'sports' : (s.tags || []).includes(S.topic));

export async function loadMore() {
  if (S.query || S.pushedList || S.ended || S.loadingMore || !S.stories.length) return;   // a search or a Recap list already shows all of itself
  S.loadingMore = true;
  const run = S.startRun;
  S.everything = S.everything || await loadEverything();
  S.loadingMore = false;
  if (run !== S.startRun) return;
  if (!S.reserve) {
    const shown = new Set(S.stories.flatMap((s) => s.clips.map((c) => c.id)));
    S.reserve = spread(orderStories(sourceList()).filter((s) => !s.clips.some((c) => shown.has(c.id))));
  }
  for (const s of S.reserve.splice(0, MORE_STORIES)) {
    S.stories.push(s);
    renderStory(s, S.stories.length - 1);
  }
  if (!S.reserve.length) showEnd();
}

// A tip, like "Tap the video to start": shown once per visit (once ever with device), and gone after FLASH_MS.
export const hinted = new Set();
export function hint(text, device = false) {
  const ever = store.get('hinted', []);
  if (hinted.has(text) || (device && ever.includes(text))) return;
  hinted.add(text);
  if (device) store.set('hinted', [...ever, text]);
  flash(text);
}
export function flash(text) {
  showHint(text);
  clearTimeout(S.flashTimer);
  S.flashTimer = setTimeout(() => { if (hintEl.textContent === text) showHint(''); }, FLASH_MS);
}

export async function refreshFeed() {
  if (S.refreshing || !S.feed) return;
  S.refreshing = true;
  flash('Checking for new stories\u2026');
  try {
    const fresh = await loadFeed();
    const known = new Set(S.feed.stories.flatMap((s) => s.clips.map((c) => c.id)));
    const added = fresh.stories.some((s) => s.clips.some((c) => !known.has(c.id)));
    S.feed = S.latest = fresh;
    markNew(false);
    if (added) {
      S.everything = null;
      if (S.query) S.everything = await loadEverything();
      onScrollStart();
      start();
      flash('New stories added');
    } else {
      flash(`You\u2019re up to date. Updated ${ago(fresh.generated)}.`);
    }
  } catch {
    flash('Couldn\u2019t reach the feed. Check your connection.');
  }
  S.refreshing = false;
}

export function markPosition(s, c) {
  const sec = storyEl(s), column = S.stories[s].clips[c].column;
  sec.querySelectorAll('.side').forEach((b) => {
    const on = b.dataset.column === column || b.dataset.column === 'all' || (b.dataset.column === 'rest' && !SIDES.includes(column));
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  sec.querySelectorAll('.tg i[data-i]').forEach((t) => t.classList.toggle('on', +t.dataset.i === c));
}

// ---------------------------------------------------------------- navigation
export const storyEl = (i) => feedEl.children[i];
export const clipsEl = (i) => storyEl(i)?.querySelector('.clips');

export function current() {
  const h = feedEl.clientHeight || 1;
  const s = Math.max(0, Math.min(S.stories.length - 1, Math.round(feedEl.scrollTop / h)));
  const sc = clipsEl(s);
  const c = sc ? Math.round(sc.scrollLeft / (sc.clientWidth || 1)) : 0;
  return [s, Math.max(0, Math.min(S.stories[s].clips.length - 1, c))];
}
export function goStory(d) {
  const [s] = current();
  const t = Math.max(0, Math.min(feedEl.children.length - 1, s + d));
  feedEl.scrollTo({ top: t * feedEl.clientHeight, behavior: SMOOTH });
}
// A clip that can't play: on to the next outlet, or the next story. (A clip that ends just plays again.)
export function advance() {
  const s = S.stories[S.activeS];
  if (!s) return;
  S.autoAdvance = true;
  if (S.activeC + 1 >= s.clips.length) return goStory(1);
  const sc = clipsEl(S.activeS);
  sc.scrollTo({ left: (S.activeC + 1) * sc.clientWidth, behavior: SMOOTH });
}
export function jumpToColumn(si, column) {
  const ci = S.stories[si].clips.findIndex((c) => c.column === column || (column === 'rest' && !SIDES.includes(c.column)));
  const sc = clipsEl(si);
  if (ci >= 0 && sc) sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
}

export let scrolling = false;
export function onScrollStart() {
  if (scrolling) return;
  scrolling = true;
  clearTimeout(S.watchTimer);
  if (S.playerReady) S.player.pauseVideo();
  wrap.classList.add('away');
  if (!g0?.axis) gesture.hidden = true;     // mid-drag, the layer holds your finger: hiding it would drop the drag
}

// the clip a new story opens on: the side you were watching (or the place you picked), else its first clip
export const opensOn = (s) => Math.max(0, S.stories[s].clips.findIndex((k) => (S.place ? k.country === S.place : k.column === openSide())));

export function settle() {
  scrolling = false;
  if (!S.stories.length || LANDSCAPE.matches || !inFeedView()) return;   // rotating moves the scroll position: keep the clip we were on
  if (S.ended && Math.round(feedEl.scrollTop / (feedEl.clientHeight || 1)) >= S.stories.length) {    // on the end screen
    if (S.playerReady) S.player.pauseVideo();
    wrap.hidden = gesture.hidden = true;
    return;
  }
  const [s, c] = current();
  for (const i of [s - 1, s, s + 1]) fitCards(storyEl(i));     // before anything shows them
  if (s !== S.activeS) {          // a new story opens on the side you were watching, if it has that side
    const ci = opensOn(s);
    if (ci > 0 && ci !== c) {
      clipsEl(s).scrollLeft = ci * clipsEl(s).clientWidth;
      clearTimeout(feedTimer);
      feedTimer = setTimeout(settle, 140);
      return;
    }
    count('story');
  } else if (c !== S.activeC && !S.autoAdvance) {   // you moved sideways yourself; skipping a broken clip doesn't change your side
    if (S.stories[s].topic !== 'sports') S.side = S.stories[s].clips[c].column;
    store.set('knowsSideways', true);
    if (hintEl.textContent === SIDEWAYS_HINT) showHint('');
  }
  S.autoAdvance = false;
  activate(s, c);
  if (s >= S.stories.length - MORE_AT) loadMore();
}

export function hintSideways() {
  if (!store.get('knowsSideways', false) && S.stories[S.activeS]?.clips.length > 1) hint(SIDEWAYS_HINT, true);
}

export function activate(s, c) {
  const clip = S.stories[s].clips[c];
  markPosition(s, c);
  if (!videosOn()) {
    S.activeS = s; S.activeC = c;
    showBeside();
    if (S.consent) hintSideways();      // while the welcome card is up, it says the same
    return;
  }
  placePlayer(s, c);
  const same = clip.id === S.currentId;
  S.activeS = s; S.activeC = c; S.currentId = clip.id;
  showBeside();
  if (!S.playerReady) return;
  storyEl(s).querySelectorAll('.clip')[c].classList.remove('err');
  if (!same) showProgress(0);
  if (same) { S.player.playVideo(); } else if (S.unlocked) { S.player.loadVideoById(clip.id); } else { S.player.cueVideoById(clip.id); }
  armPlayCheck();
}

export function placePlayer(s, c) {
  if (!videosOn()) { wrap.hidden = gesture.hidden = true; return; }     // rotating (a resize) put a black box over Text Only
  const slot = storyEl(s).querySelectorAll('.slot')[c];
  const r = slot.getBoundingClientRect();
  Object.assign(wrap.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  Object.assign(gesture.style, { left: `${r.left}px`, top: `${r.top + r.height * GESTURE_TOP}px`, width: `${r.width}px`, height: `${r.height * GESTURE_HEIGHT}px` });
  wrap.hidden = false;
  wrap.classList.remove('away');
  gesture.hidden = !S.unlocked;     // before the first real tap, taps must reach the YouTube player itself
}

// ---------------------------------------------------------------- boot
export let feedTimer = 0;
feedEl.addEventListener('scroll', () => { onScrollStart(); clearTimeout(feedTimer); feedTimer = setTimeout(settle, 140); }, { passive: true });
LANDSCAPE.addEventListener('change', (e) => {
  if (e.matches) {
    if (S.playerReady) S.player.pauseVideo();
    return;
  }
  if (S.activeS >= 0 && S.stories[S.activeS]) {
    feedEl.scrollTop = S.activeS * feedEl.clientHeight;
    clipsEl(S.activeS).scrollLeft = S.activeC * clipsEl(S.activeS).clientWidth;
  }
  settle();
});
window.addEventListener('resize', () => { if (S.activeS >= 0 && inFeedView() && S.stories[S.activeS]) placePlayer(S.activeS, S.activeC); });

// New stories wait behind a dot on the refresh button, with a short note over the sides bar that nothing can be tapped
// through: a "New Stories" button there sat on top of Left, Center and Right, and a tap meant for a side reloaded the feed.
export let newWaiting = false;
export function markNew(on) { newWaiting = on; renderBar(); }
export async function checkForNewStories() {
  if (document.visibilityState !== 'visible' || !S.feed) return;
  try {
    const fresh = await loadFeed();
    const known = new Set(S.feed.stories.flatMap((s) => s.clips.map((c) => c.id)));
    if (fresh.stories.some((s) => s.clips.some((c) => !known.has(c.id)))) {
      if (!newWaiting) flash('New stories are in: tap ↻ to see them');
      markNew(true);
    }
    S.latest = fresh;
    updateBadge();
  } catch { /* offline: keep what we have */ }
}
document.addEventListener('visibilitychange', checkForNewStories);
setInterval(checkForNewStories, CHECK_FEED_MS);

// at: { story, clip } ids to stay on (here()), if that story is still in the rebuilt feed.
// extra: a story to open that this list doesn't have (from Recap), put first.
export function start(at, extra) {
  S.startRun++;
  S.reserve = null;
  S.ended = false;
  if (S.pushedList) {
    S.stories = S.pushedList.stories;
  } else if (S.query) {
    S.stories = orderStories(matches(S.everything || S.feed.stories || [], S.query));
  } else if (S.place) {
    const all = orderStories(placeList(S.everything || [], S.place));
    const fresh = all.filter((s) => !s._seen).slice(0, MORE_STORIES);
    S.stories = fresh.length ? fresh : settings.hideWatched ? [] : all.slice(0, MORE_STORIES);
  } else {
    // Watched stories wait until the end, so they never sit in front of ones you haven't seen.
    const pool = (S.feed.stories || []).filter(inTopic);
    let fresh = orderStories(pool).filter((s) => !s._seen);
    if (!fresh.length) {       // nothing left in the top stories for this tab: look through all of them
      if (!S.everything) {
        const run = S.startRun;
        setStatus('Loading\u2026');
        loadEverything().then((all) => { S.everything = all; if (run === S.startRun) start(at, extra); });
        return;
      }
      const all = orderStories(S.everything.filter(inTopic));
      fresh = all.filter((s) => !s._seen).slice(0, MORE_STORIES);
      if (!fresh.length) fresh = settings.hideWatched ? [] : all;
    }
    S.stories = spread(fresh);
  }
  if (extra && !S.stories.some((s) => s.id === extra.id)) S.stories.unshift(extra);
  draw(at);
}

// Draws `stories` and opens on `at` if it's there, else on the first story.
export function draw(at) {
  S.currentId = null;
  S.activeS = -1;
  $('#bar-share').hidden = !S.stories.length;
  if (!S.stories.length) {
    feedEl.textContent = '';
    besideBody.textContent = '';
    wrap.hidden = gesture.hidden = true;
    scrolling = false;
    if (S.query) { setStatus(`No results for \u201C${S.query}\u201D in the last two days.`); return; }
    if (S.place) { setStatus('Nothing new from here right now.'); return; }
    setStatus(S.topic === 'all' ? 'No stories right now. Check back soon.' : `No ${TOPICS[S.topic].toLowerCase()} stories right now.`);
    return;
  }
  setStatus('');
  render();
  if (S.query || S.pushedList || S.ended) showEnd();
  const si = at ? S.stories.findIndex((s) => s.id === at.story) : -1;
  fitCards(storyEl(Math.max(si, 0)));
  const s0 = Math.max(si, 0), ci = si < 0 ? opensOn(0) : Math.max(0, S.stories[si].clips.findIndex((c) => c.id === at.clip));
  feedEl.scrollTop = s0 * feedEl.clientHeight;
  clipsEl(s0).scrollLeft = ci * clipsEl(s0).clientWidth;     // the first story opens on your side at once, not with a jump when the player is ready
  markPosition(s0, ci);
  if (si >= 0) { S.activeS = si; S.activeC = ci; }     // the same story, not a new one: settle mustn't turn it to your usual side
  if (S.playerStarted || !videosOn()) { settle(); return; }
  S.playerStarted = true;
  createPlayer(S.stories[s0].clips[ci].id);
}
