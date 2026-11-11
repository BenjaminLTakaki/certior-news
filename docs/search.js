// Certior: search, and the two-day list that search, World and Recap read.
import { $, FEED_URL, RECENT_MAX, S, ago, count, el, feedEl, leaveFeed, setStatus, settings, store } from './shared.js';
import { bySide, onScrollStart, renderBar, show, start } from './feed.js';

// ---------------------------------------------------------------- search
export function renderRecent() {
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
export async function runSearch(q, from = 'search', at) {
  count('search');
  leaveFeed();
  S.query = q;
  S.place = ''; S.pushedList = null;
  S.searchFrom = from;
  if (from === 'search') store.set('recentSearches', [q, ...store.get('recentSearches', []).filter((r) => r !== q)].slice(0, RECENT_MAX));
  $('#search-input').blur();
  renderBar();
  onScrollStart();
  feedEl.textContent = '';
  setStatus('Searching\u2026');
  S.stories = [];
  show(from, { pushed: true });
  S.everything = S.everything || await loadEverything();
  start(at && { story: at });
}
// The matching headlines as you type, in the order they'd play; tap one to watch from it, or Search to watch them all.
export async function showResults() {
  const input = $('#search-input'), q = input.value.trim(), hint = $('#search-hint'), box = $('#search-results');
  $('#search-recent').hidden = !!q;
  box.textContent = '';
  if (!q || !S.feed) { hint.textContent = ''; if (!q) renderRecent(); return; }
  S.everything = S.everything || await loadEverything();
  if (input.value.trim() !== q) return;      // you typed on while it loaded
  const found = orderStories(matches(S.everything, q));
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

export async function loadEverything() {
  try {
    const r = await fetch(`${FEED_URL.replace('feed.json', 'search.json')}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`search ${r.status}`);
    return bySide((await r.json()).stories);
  } catch {
    return S.feed.stories;      // better a smaller search than none
  }
}

// Whole words, so "AI" doesn't find "said". Longer words also match their endings ("election" finds "elections").
// Stories with every word first; if there are none, stories with any of them.
export function matches(list, q) {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const rx = words.map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}${w.length >= 4 ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu'));
  const text = (s) => [s.headline, ...s.clips.map((c) => c.title)].join(' ');
  const all = list.filter((s) => rx.length && rx.every((r) => r.test(text(s))));
  return all.length ? all : list.filter((s) => rx.some((r) => r.test(text(s))));
}

export function orderStories(list) {
  // unseen stories first (feed order = ranking), fully watched ones at the end
  const seen = (s) => s.clips.every((c) => S.watched.has(c.id));
  const unseen = list.filter((s) => !seen(s));
  return settings.hideWatched ? unseen : [...unseen, ...list.filter(seen).map((s) => ({ ...s, _seen: true }))];
}
