// Certior (built in the certior-news repo) — one story per screen. Swipe up/down = next/previous story,
// swipe left/right = the same story from another outlet.
// One YouTube player is reused for every clip and laid over the active clip's video area.
// The screens are modules (shared, feed, player, search, recap, world, compare, settings); this file only starts them.

import { S, ago, count, countVisit, params, setStatus, welcomeEl } from './shared.js';
import { NEWER_CHECK_MS, checkForNewStories, flash, loadFeed, renderBar, show, start } from './feed.js';
import { loadEverything } from './search.js';
import { cameBack, openStory, updateBadge } from './recap.js';
import { fitWelcome } from './settings.js';

cameBack();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* offline just won't work */ });

countVisit();

(async function boot() {
  renderBar();
  show('news');
  if (!S.consent) { welcomeEl.hidden = false; fitWelcome(); }
  try {
    S.feed = S.latest = await loadFeed();
  } catch (e) {
    setStatus('Couldn’t load the feed. Check your connection.', true);
    return;
  }
  // a shared link: ?story=…&clip=…, found by the clip too in case the story's id changed since
  const linked = params.get('story'), linkedClip = params.get('clip');
  if (linked) {
    if (['share', null].includes(params.get('ref'))) count('shared_open');      // not your own caption link (ref=social)
    history.replaceState(null, '', params.get('feed') ? `?feed=${encodeURIComponent(params.get('feed'))}` : location.pathname);
    const find = (list) => list.find((s) => s.id === linked) || list.find((s) => s.clips.some((c) => c.id === linkedClip));
    const s = find(S.feed.stories) || find(S.everything = await loadEverything());
    if (s) { openStory(s, linkedClip); updateBadge(); return; }
    flash('That story is more than two days old, so it’s no longer here.');
  }
  start();
  if (!navigator.onLine) flash(`You’re offline. These are the stories from ${ago(S.feed.generated)}.`);
  updateBadge();
  setTimeout(checkForNewStories, NEWER_CHECK_MS);     // on a slow start the saved copy came first: offer the newer one
})();
