// Certior: the Compare sheet (and the list beside the feed on a wide screen), and sharing a story.
import { storyCard } from './card.js';
import { $, COLUMNS, COUNTRY, REDUCED, S, SIDES, SMOOTH, ago, byline, compareEl, count, el, settings, store } from './shared.js';
import { clipsEl, flash, settle } from './feed.js';

// ---------------------------------------------------------------- compare sheet
export function closeSheet(d) {
  if (!d.open || d.classList.contains('closing')) return;
  if (REDUCED) return d.close();
  d.classList.add('closing');
  setTimeout(() => { d.classList.remove('closing'); d.style.transform = ''; d.close(); }, 220);
}
compareEl.querySelector('.done').onclick = () => closeSheet(compareEl);
compareEl.addEventListener('close', () => { if (S.feed) settle(); });
compareEl.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(compareEl); });
compareEl.addEventListener('click', (e) => {      // the dimmed area above it, and beside it on a wide screen
  if (e.target === compareEl && (e.offsetY < 0 || e.offsetX < 0 || e.offsetX > compareEl.clientWidth)) closeSheet(compareEl);
});
export const sheetHead = compareEl.querySelector('.sheet-head');
export let drag = null;
sheetHead.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  drag = e.clientY;
  sheetHead.setPointerCapture(e.pointerId);
});
sheetHead.addEventListener('pointermove', (e) => { if (drag !== null) compareEl.style.transform = `translateY(${Math.max(0, e.clientY - drag)}px)`; });
export const endDrag = (e) => {
  if (drag === null) return;
  const moved = e.clientY - drag;
  drag = null;
  if (moved > 100) closeSheet(compareEl); else compareEl.style.transform = '';
};
sheetHead.addEventListener('pointerup', endDrag);
sheetHead.addEventListener('pointercancel', endDrag);

export function gap(ms) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return m < 60 ? `${m}m` : `${h}h${h < 10 && m % 60 ? ` ${m % 60}m` : ''}`;
}
// Outlets in the order they first posted about the story, and how fast it crossed regions.
// Only for a story under FIRST_MAX_H old, and from the same clips as the list above it. On a story that ran for days,
// "first" only meant "oldest clip still in the two-day window", and contradicted the list.
export const FIRST_MAX_H = 12, FIRST_ROWS = 6;
export function timeline(s) {
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
$('#bar-share').onclick = () => { const s = S.stories[S.activeS]; if (s) shareStory(s, s.clips[S.activeC]?.id ?? s.clips[0].id); };
export async function shareStory(s, currentClip) {
  count('share');
  const url = `${location.origin}${location.pathname}?story=${encodeURIComponent(s.id)}&clip=${encodeURIComponent(currentClip)}&ref=share`;
  const data = { title: s.headline, text: 'How different outlets covered it', url };
  try {
    const blob = await storyCard(s, currentClip);
    const files = blob ? [new File([blob], 'certior.png', { type: 'image/png' })] : [];
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

// Every outlet's headline for a story, grouped by side: in the Compare sheet, and beside the feed on a wide screen
// (beside: it stays open, so picking a headline closes nothing, and the note on the ratings at the end is enough).
export function fillCompare(box, si, currentClip, beside) {
  const s = S.stories[si];
  box.textContent = '';
  box.append(el('p', 'compare-story', s.headline));
  if (!beside && !store.get('knowsRatings', false) && s.topic !== 'sports') {      // the first Compare explains the sides, not the welcome
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
    const cell = (c) => {
      const b = el('button', 'cell headline' + (c.id === currentClip ? ' now' : ''));
      b.type = 'button';
      if (c.id === currentClip) b.setAttribute('aria-current', 'true');
      const by = el('span', 'headline-sub');
      by.append(el('b', '', c.channel), ` \u00b7 ${byline(c, s, true)}`);
      b.append(el('span', 'headline-title', c.title), by);
      if (c.note && settings.notes) b.append(el('span', 'headline-meta', c.note));     // in full: the player's box can cut it off
      b.onclick = () => {
        const ci = s.clips.indexOf(c), sc = clipsEl(si);
        if (!beside) closeSheet(compareEl);
        sc.scrollTo({ left: ci * sc.clientWidth, behavior: SMOOTH });
      };
      return b;
    };
    // Beside the feed, a side with many outlets shows two (and the one you're on) and a button for the rest, so the
    // first view has every side: six Left headlines pushed Center and Right below the fold.
    const key = `${s.id}:${col}`, short = beside && clips.length > 3 && !besideOpen.has(key);
    const shown = short ? clips.filter((c, i) => i < 2 || c.id === currentClip) : clips;
    group.append(...shown.map(cell));
    if (shown.length < clips.length) {
      const more = el('button', 'cell action', `Show ${clips.length - shown.length} More`);
      more.type = 'button';
      more.onclick = () => {
        besideOpen.add(key);
        const cells = clips.map(cell);
        group.replaceChildren(...cells);
        cells[clips.findIndex((c) => !shown.includes(c))].focus();      // the button is gone: on to the first new headline
      };
      group.append(more);
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
}
export function openCompare(si, currentClip) {
  count('compare');
  fillCompare($('#compare-body'), si, currentClip);
  if (S.playerReady) S.player.pauseVideo();
  compareEl.showModal();
}
// A wide screen has room for that list next to the feed, for the story and outlet you're on. Must match style.css.
export const WIDE = matchMedia('(min-width: 1180px) and (min-height: 501px)');
export const besideBody = $('#beside-body');
export let besideStory = null;
export const besideOpen = new Set();      // "story:side" lists opened in full beside the feed, so a swipe doesn't fold them again
export function showBeside() {
  const s = S.stories[S.activeS];
  if (!WIDE.matches || !s) return;
  fillCompare(besideBody, S.activeS, s.clips[S.activeC].id, true);
  if (besideStory !== s.id) { besideStory = s.id; besideBody.parentElement.scrollTop = 0; }
}
WIDE.addEventListener('change', showBeside);
