// Certior: World, what outlets in each country are covering.
import { $, COUNTRY, REGION_LABEL, S, SOMEWHERE_MIN, count, el, leaveFeed } from './shared.js';
import { flash, onScrollStart, renderBar, show, start } from './feed.js';
import { loadEverything } from './search.js';

// ---------------------------------------------------------------- world
export function countriesIn(list) {
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
export function placeList(list, country) {
  const here = list.filter((s) => s.topic !== 'sports' && s.clips.some((c) => c.country === country));
  const only = (s) => s.clips.every((c) => c.country === country);
  return [...here.filter(only), ...here.filter((s) => !only(s))];
}

export async function renderWorld() {
  const box = $('#world-list');
  if (!S.everything) {
    box.textContent = '';
    box.append(el('p', 'group-note', 'Loading\u2026'));
    S.everything = await loadEverything();
  }
  box.textContent = '';
  const countries = countriesIn(S.everything);
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

export async function goTo(country) {
  count('world');
  S.everything = S.everything || await loadEverything();
  leaveFeed();
  S.place = country;
  S.lastPlace = country;
  S.query = ''; S.pushedList = null;
  renderBar();
  onScrollStart();
  S.pageOpen = false;
  start();
  show('world', { pushed: true });
  flash(`What outlets in ${COUNTRY[country]?.[0] ?? country} are covering`);
}

export async function takeMeSomewhere() {
  S.everything = S.everything || await loadEverything();
  const options = countriesIn(S.everything).filter((c) => c.stories >= SOMEWHERE_MIN && c.country !== S.lastPlace);
  if (options.length) goTo(options[Math.floor(Math.random() * options.length)].country);
}
$('#somewhere').onclick = takeMeSomewhere;
