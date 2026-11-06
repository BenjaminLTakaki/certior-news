# Swipe News

Short news clips from 52 outlets around the world, grouped by story. **Swipe up** for the next story, **swipe sideways** to see the same story from Left, Center and Right outlets. It runs as a Home Screen web app on iPhone and costs €0.

```
YouTube Data API ──► GitHub Actions (every 10 min) ──► GitHub Pages ──► portfolio site ──► iPhone
  52 outlet channels   fetch → filter → group             story feed         hosts the app      plays clips straight from YouTube
```

## One-time setup (≈15 minutes)

### 1. Get a free YouTube API key
1. Go to <https://console.cloud.google.com/> and create a project (e.g. `swipe-news`). No billing account is needed.
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. Click the key → **API restrictions → Restrict key → YouTube Data API v3** → Save. (Then a leaked key can't be used for anything else.)

### 2. Add the key to this repo
**Settings → Secrets and variables → Actions → New repository secret**
- Name: `YT_API_KEY`
- Value: the key from step 1

### 3. Host the app
The app is hosted by the portfolio at <https://www.benjamintakaki.com/swipe-news/>, from a copy of `docs/` in that repo's `public/swipe-news`. App changes need that copy updated and a Render deploy; new stories don't, because the app reads the feed from GitHub Pages.

### 4. Run the feed once
**Actions → Update feed → Run workflow**. It takes 1–3 minutes the first time (it downloads the small embedding model once and caches it). After that the portfolio's server starts it every 10 minutes, if its `SWIPE_NEWS_DISPATCH_TOKEN` is set (a fine-grained GitHub token with Actions: write on this repo). GitHub's own schedule stays on as a backup, but it ran only once in 12 hours when it was all there was.
If the log says `handles not found`, fix those handles in `channels.json` (open the outlet's YouTube page; the handle is the `@name` in the URL).

### 5. Install on your iPhone
Open the app in **Safari → Share → Add to Home Screen**. Open it from the Home Screen icon.
**The first time, tap the video itself to start.** iOS only allows sound after a real tap on the player; after that, swiping plays the next clips with sound.

## Using it
| Gesture | What happens |
| --- | --- |
| Swipe up / down on the video | Next / previous story |
| Swipe left / right on the video | Same story, next outlet (Left → Center → Right) |
| Tap the video | Pause / play |
| Double-tap the left / right of the video | Back / forward 10 seconds (keep tapping to skip more) |
| Tap the title at the top | Choose a topic |
| Tap **Recap** | The biggest stories of each day this week, and the ones that began since your last visit (the badge counts them after you've been away an hour) |
| Tap **World** | Pick a country, or Take Me Somewhere, to see what its outlets are covering |
| Tap **Compare** | Every outlet's headline for the story, by side; who posted it first; **Share This Story** sends a card with a headline from each side and a link that opens the story |
| Tap **Search** | Search every story from the last two days |
| Tap **Left / Center / Right** | Jump to that side; a grayed-out side has no coverage here (not shown for sport) |
| 🔈 | Sound on/off |
| **YouTube ↗** | Open the clip in the YouTube app |

- Stories covered in several regions rank first. Stories you can compare across sides come first; stories from one side, one region or one outlet sink. At most one story in every four is US domestic politics, however widely it is covered. Watched stories move to the end and are dimmed.
- When a clip finishes, the app moves to the next outlet, then to the next story.
- A **New stories** button appears when there are new clips, or tap the refresh icon to check. The feed starts with the top stories and loads the rest as you get near the end.

## Tuning the grouping (do this after 2–3 days)
`python -m pipeline.tune pairs` scores the threshold on 200 real clip pairs in `tests/fixtures/real_pairs.json`. They were sampled to be hard and labelled by Claude, not an independent reviewer: at 0.73, about 90% of the pairs it groups are right and it finds about 85% of real matches. To fit it to your own labels, on your PC:

```bash
git fetch origin feed && git checkout FETCH_HEAD -- data && git reset -q data    # get the latest data/clips.json
pip install -r pipeline/requirements.txt
python -m pipeline.tune export             # writes data/labels.csv with the app's current grouping
#   open data/labels.csv, fix the `story` column so clips about the same event share a label (~100 rows is enough)
python -m pipeline.tune evaluate           # tries many thresholds, prints the best
```
Copy the suggested number into `THRESHOLDS` in `pipeline/config.py`, commit, push. The setting it picks keeps wrong merges near zero, because an unrelated clip when you swipe sideways is worse than a missed one.

`python -m pipeline.tune merges` scores the second pass, which joins stories the first one split, on `tests/fixtures/real_window.json.gz` (every clip of one real 48 h window, with the split events and the stories that must stay apart labelled by Claude). It prints stories before and after, how many stories each event is still in, and every wrong merge, for the `MERGE_*` settings in `config.py` and a few around them.

Other knobs in `pipeline/config.py`: the title blocklist (promos, "full episode"…), max clip length, how long stories stay in the feed.

## Changing outlets
Edit `channels.json`. `lean` is the outlet's [Media Bias/Fact Check](https://mediabiasfactcheck.com) rating and sets the side it appears under (`left` + `lean-left` = Left, `center` = Center, `lean-right` + `right` = Right, `unrated` = Not rated). `region` (`mideast_africa`, `americas`, `asia`, `europe`) is where the outlet is based and is used for ranking. `country` is shown next to the outlet name. `"topic": "sports"` puts all of an outlet's clips under Sports, and `"tags"` always puts a specialist outlet's clips under those tabs (Vogue under Culture, WIRED under Tech). `"aliases"` lists other names an outlet signs its titles with (`"FRANCE 24"` for FRANCE 24 English), so they're cut from the end of its titles. Changes apply on the next run, including to clips already collected.

## Running it on your PC (Windows)
```bash
pip install -r pipeline/requirements.txt
python -m pytest -q                                                   # tests
python -m pipeline.run --mock tests/fixtures/sample_clips.json --out docs/feed.mock.json   # demo feed, no API key
python -m http.server 8000 -d docs                                    # then open http://localhost:8000/?feed=feed.mock.json
set YT_API_KEY=your-key && python -m pipeline.run                      # real run (cmd.exe)
```
The demo feed uses fake clip IDs, so videos won't play; it's for checking the layout and swipes.
To test on the iPhone over Wi-Fi, open `http://<your-PC-IP>:8000/` and add `?debug=1` for an on-screen console (Safari's Web Inspector needs a Mac).

## How it works
- **`pipeline/run.py`**: for each channel, lists the newest 25 uploads (1 quota unit), fetches details only for IDs it hasn't seen (1 unit per 50), and keeps embeddable, public, non-live clips of 8 s – 5 min from the last 48 h that don't match the blocklist. Roughly 8,000 to 9,000 of the 10,000 free daily units at one run every 10 minutes with 52 outlets. Adding many more outlets means building less often.
- **`pipeline/grouping.py`**: embeds each cleaned title with `bge-base-en-v1.5` (via fastembed, CPU). Two clips can share a story only if they are close *and* share a distinctive word, which keeps "two different shootings" apart. Complete-linkage clustering holds every pair in a story to that bar, so one big event doesn't snowball into a single story. That splits an event when outlets word it differently, so a second pass joins whole stories that are close and share specific words across their titles and descriptions, again with complete linkage. If the model can't load, it falls back to TF-IDF so the feed never breaks. Each story's summary is one sentence picked from its outlets' own descriptions (closest to the titles and the headline, never promo), so it costs nothing and says only what an outlet said.
- **`docs/`**: plain HTML/CSS/JS, no build step. `sw.js` keeps the app and the last feed for offline use, network first. One YouTube IFrame player is reused for every clip and laid over the active clip, with a transparent layer on top that turns swipes into navigation.
- State lives in `data/` (clips from the last 72 h, rejected IDs, resolved channel IDs, `digest.json`: each day's top 10 stories for Recap, and `framing.json`: the words each Left/Right outlet used for stories both sides covered; both kept 7 days and summarised in `feed.json`). `pipeline/framing.py` explains the framing-words test. To fill Recap's week at once (a new install, or after losing `data/`), run **Update feed** from the Actions tab with `backfill_days` = 7: it costs about 500 quota units. and is published with the feed on the `feed` branch, which GitHub Pages serves. Each build replaces that branch with one commit, so it never grows.

## Troubleshooting
| Problem | Fix |
| --- | --- |
| Feed never updates | Actions tab → check the latest **Update feed** run. Scheduled runs pause after 60 days without repo activity; GitHub emails you, and **Enable workflow** turns it back on. |
| `YT_API_KEY is not set` | Step 2 above. |
| `quotaExceeded` | Change the cron in `.github/workflows/update-feed.yml` to hourly (`7 * * * *`). |
| "Video player configuration error 153" | The page must send a Referer. Don't add a stricter `Referrer-Policy`; `index.html` already sets `strict-origin-when-cross-origin`. |
| No sound after swiping | Tap the video once; the app shows **Tap the video to play** when iOS blocks autoplay. |
| A clip says it can't play here | The outlet blocked embedding for that clip; the app skips it after 2.5 s. |
