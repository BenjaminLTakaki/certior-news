// Certior: the first-visit welcome with its choice of videos, and Settings.
import { $, S, count, here, renderMix, settings, store, videosOn, welcomeEl } from './shared.js';
import { start } from './feed.js';

// ---------------------------------------------------------------- welcome + consent
// A first visit gets the stories at once, as text, with the welcome card over the bottom of the feed. (The welcome
// used to be a full screen in front of the app: on 7 Nov 2026, 23 first visits made 11 choices there.) Nothing loads
// from YouTube until Turn On Videos. The feed ends where the card begins: --welcome-h, 0 once it's gone.
export const fitWelcome = () => document.documentElement.style.setProperty('--welcome-h', `${welcomeEl.offsetHeight}px`);
new ResizeObserver(fitWelcome).observe(welcomeEl);      // its text wraps differently when the window changes
export function chooseVideos(on) {
  S.consent = on ? 'videos' : 'text';
  store.set('consent', S.consent);
  document.documentElement.classList.toggle('videos', on);
  welcomeEl.hidden = true;
  fitWelcome();      // now, not a frame later: the feed is measured as soon as it's drawn again
}
export function finishWelcome(on) {
  chooseVideos(on);
  count(`mode_${S.consent}`);      // the day's visit was counted before the choice
  if (S.feed) start(here());      // drawn again where you were: with videos, or as text in the room the card took
}
$('#consent-videos').onclick = () => finishWelcome(true);
$('#consent-text').onclick = () => finishWelcome(false);

// ---------------------------------------------------------------- settings
S.settingsChanged = false, S.redraw = false;
export const toggles = ['hideWatched', 'sportsInAll', 'notes'];
export function saveSettings() {
  store.set('settings', settings);
  S.settingsChanged = true;
}
export function syncSettings() {
  $('#set-videos').checked = videosOn();
  $('#set-side').value = settings.side;
  for (const t of toggles) $(`#set-${t}`).checked = settings[t];
  $('#set-clear').textContent = 'Clear Watched History';
  renderMix($('#settings-mix'));
}
for (const t of toggles) {
  $(`#set-${t}`).onchange = (e) => { settings[t] = e.target.checked; saveSettings(); };
}
$('#set-side').onchange = (e) => { settings.side = e.target.value; saveSettings(); };
$('#set-videos').onchange = (e) => {
  chooseVideos(e.target.checked);
  if (e.target.checked) S.redraw = true;
  else location.reload();     // the only way to fully take the YouTube player back out of the page
};
$('#set-clear').onclick = (e) => {
  S.watched = new Set();
  store.set('watched', []);
  S.settingsChanged = true;
  e.target.textContent = 'Cleared';
};
$('#set-reset').onclick = () => {
  if (!confirm('Reset this device? This clears your settings, watched history and video choice.')) return;
  try { localStorage.clear(); } catch { /* private mode etc. */ }
  location.reload();
};
