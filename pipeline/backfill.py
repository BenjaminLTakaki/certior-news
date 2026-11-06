"""Fill Recap's week now instead of waiting seven days: daily top stories (data/digest.json) and framing words
(data/framing.json).

    python -m pipeline.backfill --days 7        (run by the "Update feed" workflow when you give it backfill_days)

Pages each outlet's uploads back that many days (about 500 quota units for a week at ~50 outlets; a normal day uses
8,000 to 9,000 of the 10,000), then replays the pipeline once per past day as it would have run at the end of that
day, so the result matches what a week of normal runs would have saved. Clips it fetches are not kept: data/clips.json
stays the last 72 hours.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from . import config, framing, youtube
from .filters import parse_time, to_clip
from .grouping import build_stories, embed, group
from .run import apply_channels, iso, load_json, save_json, update_digest


def fetch_older(channels: list[dict], cache: dict, known: set, since: datetime) -> dict:
    by_id = {}
    for ch in channels:
        info = cache.get(ch["handle"])
        if not info:
            continue
        for vid in youtube.uploads_since(info["uploads"], iso(since)):
            if vid not in known:
                by_id[vid] = ch
    out = {}
    for item in youtube.video_details(list(by_id)):
        if item.get("id") in by_id:
            clip, _ = to_clip(item, by_id[item["id"]], parse_time(item["snippet"]["publishedAt"]))     # judged when it was new
            if clip:
                out[clip["id"]] = clip
    return out


def replay(clips: list[dict], digest: list[dict], words: dict, ends: list[datetime]) -> tuple[list[dict], dict]:
    """Runs grouping, the digest and framing as of each time in `ends`, oldest first."""
    clips = sorted(clips, key=lambda c: c["published"])
    name, X = embed(clips)
    for end in ends:
        idx = [i for i, c in enumerate(clips) if end - timedelta(hours=config.MAX_AGE_HOURS) <= parse_time(c["published"]) < end]
        if len(idx) < 2:
            continue
        window, Xw = [clips[i] for i in idx], X[idx]
        _, groups, _ = group(window, embedded=(name, Xw))
        digest = update_digest(digest, build_stories(window, groups, Xw, end, capped=False), end)
        words = framing.observe(words, window, groups)
        print(f"[backfill] {iso(end)}: {len(window)} clips, {len(groups)} stories")
    return digest, words


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=config.DIGEST_DAYS)
    days = max(1, min(ap.parse_args(argv).days, config.DIGEST_DAYS))
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    channels = load_json(config.CHANNELS_FILE, {})["channels"]
    store = load_json(config.CLIPS_FILE, {})
    cache = load_json(config.CHANNEL_CACHE_FILE, {})
    since = midnight - timedelta(days=days) - timedelta(hours=config.MAX_AGE_HOURS)
    known = set(store) | set(load_json(config.REJECTED_FILE, {}))
    older = fetch_older(channels, cache, known, since)
    clips = list(apply_channels({**older, **store}, channels).values())
    ends = [midnight - timedelta(days=d) for d in range(days - 1, -1, -1)]      # the end of each past day
    digest, words = replay(clips, load_json(config.DIGEST_FILE, []), load_json(config.FRAMING_FILE, {}), ends)
    save_json(config.DIGEST_FILE, digest)
    save_json(config.FRAMING_FILE, framing.prune(words, now), compact=True)
    print(f"[backfill] {len(older)} older clips, {len(digest)} digest entries, {len(words)} framing headlines, "
          f"quota_units={youtube.QuotaUsed.units}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
