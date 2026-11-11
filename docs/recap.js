// Certior: Recap, what's new since your last visit and your week's mix.
import { $, AWAY_MS, COLUMNS, RECAP_MIN_OUTLETS, RECAP_NEW_MAX, S, SIDES, ago, count, dayKey, el, leaveFeed, settings, store } from './shared.js';
import { onScrollStart, renderBar, show, start } from './feed.js';
import { loadEverything, runSearch } from './search.js';

// ---------------------------------------------------------------- recap
// "Since your last visit" starts when you left the app, if you were gone at least AWAY_MS.
export let since = 0, leftAt = store.get('lastSeen', 0), recapSeen = false;
export function cameBack() {
  if (leftAt && Date.now() - leftAt >= AWAY_MS) { since = leftAt; recapSeen = false; }
  leftAt = 0;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { leftAt = Date.now(); store.set('lastSeen', leftAt); return; }
  cameBack();
  updateBadge();
});
window.addEventListener('pagehide', () => store.set('lastSeen', Date.now()));

export const recapTopic = (s) => settings.sportsInAll || s.topic !== 'sports';
export const newSince = (list) => (since ? list.filter((s) => !s.single && recapTopic(s) && Date.parse(s.first) > since) : []).slice(0, RECAP_NEW_MAX);
export function updateBadge() {
  const n = recapSeen || !S.latest ? 0 : newSince(S.latest.stories).length, badge = $('#recap-badge');
  badge.hidden = !n;
  badge.textContent = n;
  $('#tabbar [data-tab="recap"]').setAttribute('aria-label', n ? `Recap, ${n} new ${n === 1 ? 'story' : 'stories'}` : 'Recap');
}

export function dayLabel(day) {
  if (day === dayKey()) return 'Today';
  if (day === dayKey(Date.now() - 864e5)) return 'Yesterday';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// The first headline from each side, in swipe order: a story told by its sides, not by one outlet's summary.
export const sideHeads = (s) => Object.fromEntries(SIDES.map((k) => [k, s.clips.find((c) => c.column === k)]).filter(([, c]) => c));

// A row opens the story over the feed while it's still in the last two days (Back returns here), and its clip on
// YouTube after that. open(live) gets the story the row stands for.
export function recapRow(e, live, open, when) {
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

export async function renderRecap() {
  count('recap');
  recapSeen = true;
  updateBadge();
  const box = $('#recap-list'), src = S.latest || S.feed;
  if (!src) return;
  if (!S.everything) {
    box.textContent = '';
    box.append(el('p', 'group-note', 'Loading…'));
    S.everything = await loadEverything();
  }
  const byClip = new Map([...S.everything, ...src.stories].flatMap((s) => s.clips.map((c) => [c.id, s])));
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
export function renderFraming(box, f) {
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

export function openRecapList(title, list, s) {
  leaveFeed();
  S.place = ''; S.query = '';
  S.pushedList = { title, stories: list };
  S.searchFrom = 'recap';
  renderBar();
  onScrollStart();
  S.pageOpen = false;
  start({ story: s.id });
  show('recap', { pushed: true });
}

export function openStory(s, clip) {
  S.place = ''; S.query = '';
  renderBar();
  onScrollStart();
  S.pageOpen = false;
  start({ story: s.id, clip }, s);
  show('news');
}
