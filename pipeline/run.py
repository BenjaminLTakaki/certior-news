"""One pipeline run: fetch new clips -> filter -> group into stories -> write docs/feed.json.

    python -m pipeline.run                 # real run (needs YT_API_KEY)
    python -m pipeline.run --mock tests/fixtures/sample_clips.json --out docs/feed.mock.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config, framing, youtube
from .filters import parse_time, to_clip
from .grouping import build_stories, cap_feed, group


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, obj, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(obj, ensure_ascii=False, indent=1)
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(channels: list[dict], store: dict, rejected: dict, cache: dict, now: datetime) -> dict:
    log = {"channels_ok": 0, "channels_missing": [], "new": 0, "rejected": Counter()}
    by_id: dict[str, dict] = {}
    for ch in channels:
        h = ch["handle"]
        if h not in cache:
            info = youtube.resolve_handle(h)
            if not info:
                log["channels_missing"].append(f"{ch['name']} ({h})")
                continue
            cache[h] = info
        try:
            ids = youtube.latest_upload_ids(cache[h]["uploads"], config.UPLOADS_PER_CHANNEL)
        except RuntimeError as e:
            print(f"[fetch] {ch['name']}: {e}", file=sys.stderr)
            continue
        log["channels_ok"] += 1
        for vid in ids:
            if vid not in store and vid not in rejected:
                by_id[vid] = ch
    for item in youtube.video_details(list(by_id)):
        if item.get("id") not in by_id:
            continue
        clip, reason = to_clip(item, by_id[item["id"]], now)
        if clip:
            store[clip["id"]] = clip
            log["new"] += 1
        else:
            rejected[item["id"]] = iso(now)
            log["rejected"][reason.split(":")[0]] += 1
    return log


def add_shapes(store: dict, limit: int = 150) -> int:
    """Mark each clip widescreen or not, once, so the app can put the other sides' headlines under a widescreen video.
    Newest first and at most `limit` a run; if YouTube stops answering, the rest wait for the next run."""
    asked = 0
    for c in sorted((c for c in store.values() if "wide" not in c), key=lambda c: c["published"], reverse=True)[:limit]:
        wide = youtube.is_wide(c["id"])
        if wide is None:
            break
        c["wide"] = wide
        asked += 1
    return asked


def apply_channels(store: dict, channels: list[dict]) -> dict:
    """channels.json decides: a removed outlet's clips leave the feed and a changed region or lean applies at once."""
    by_name = {c["name"]: c for c in channels}
    out = {}
    for k, v in store.items():
        ch = by_name.get(v["channel"])
        if ch:
            out[k] = {**v, "region": ch["region"], "country": ch["country"], "lean": ch["lean"], "topic": ch.get("topic", ""), "note": ch.get("note", ""), "tags": ch.get("tags", []), "aliases": ch.get("aliases", []),
                      "column": config.column_of(ch)}
    return out


def load_mock(path: Path, now: datetime) -> dict:
    """Fixture clips carry `minutes_ago` instead of a timestamp so the demo is always 'fresh'."""
    store = {}
    for c in load_json(path, []):
        c = dict(c)
        c["published"] = iso(now - timedelta(minutes=c.pop("minutes_ago")))
        c.setdefault("country", "")
        c.setdefault("desc", "")
        c.setdefault("duration", 60)
        store[c["id"]] = c
    return store


def by_side(s: dict) -> dict:
    """The first headline from each side, in swipe order: Recap shows these instead of one outlet's summary."""
    out = {}
    for c in s["clips"]:
        if c["column"] in ("left", "center", "right"):
            out.setdefault(c["column"], {"channel": c["channel"], "title": c["title"]})
    return out


def update_digest(digest: list[dict], stories: list[dict], now: datetime) -> list[dict]:
    """Recap: each day's biggest stories for the past week: the most outlets they ever reached (DIGEST_MIN_OUTLETS or
    more), then the highest score. A story is filed under the day it began, and is recognised across builds by sharing
    a clip (its id can change when stories merge)."""
    digest = [dict(e) for e in digest]
    for s in stories:
        if s["single"]:
            continue
        ids = {c["id"] for c in s["clips"]}
        old = next((e for e in digest if ids & set(e["clips"])), None)
        entry = {
            "day": min(s["first"][:10], old["day"]) if old else s["first"][:10],
            "headline": s["headline"], "topic": s["topic"], "sides": s["sides"], "by_side": by_side(s),
            "outlets": max(sum(s["coverage"].values()), old.get("outlets", 0) if old else 0),
            "score": max(s["score"], old["score"]) if old else s["score"],
            # ponytail: only the clips the feed keeps (newest per outlet); add all member ids if repeats show up
            "clips": sorted(ids | set(old["clips"])) if old else sorted(ids),
        }
        if old:
            digest.remove(old)
        digest.append(entry)
    since = (now - timedelta(days=config.DIGEST_DAYS - 1)).strftime("%Y-%m-%d")
    out = []
    for day in sorted({e["day"] for e in digest if e["day"] >= since}, reverse=True):
        big = [e for e in digest if e["day"] == day and e["outlets"] >= config.DIGEST_MIN_OUTLETS]
        out += sorted(big, key=lambda e: (e["outlets"], e["score"]), reverse=True)[:config.DIGEST_PER_DAY]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", type=Path, help="use a fixture file instead of the YouTube API")
    ap.add_argument("--out", type=Path, default=config.FEED_FILE)
    args = ap.parse_args(argv)

    now = datetime.now(timezone.utc)
    channels = load_json(config.CHANNELS_FILE, {})["channels"]

    if args.mock:
        store, log = load_mock(args.mock, now), {"mock": True}
    else:
        store = load_json(config.CLIPS_FILE, {})
        rejected = load_json(config.REJECTED_FILE, {})
        cache = load_json(config.CHANNEL_CACHE_FILE, {})
        log = fetch(channels, store, rejected, cache, now)
        # prune state
        cutoff = now - timedelta(hours=config.WINDOW_HOURS)
        store = {k: v for k, v in apply_channels(store, channels).items() if parse_time(v["published"]) >= cutoff}
        rejected = {k: v for k, v in rejected.items() if parse_time(v) >= cutoff}
        log["shapes"] = add_shapes(store)
        save_json(config.CLIPS_FILE, store)
        save_json(config.REJECTED_FILE, rejected)
        save_json(config.CHANNEL_CACHE_FILE, cache)

    max_age = now - timedelta(hours=config.MAX_AGE_HOURS)
    window = sorted((c for c in store.values() if parse_time(c["published"]) >= max_age),
                    key=lambda c: c["published"])
    embedder, groups, X = group(window)
    everything = build_stories(window, groups, X, now, capped=False)
    stories = cap_feed(everything)

    digest = update_digest([] if args.mock else load_json(config.DIGEST_FILE, []), everything, now)
    words = framing.prune(framing.observe({} if args.mock else load_json(config.FRAMING_FILE, {}), window, groups), now)
    if not args.mock:
        save_json(config.DIGEST_FILE, digest)
        save_json(config.FRAMING_FILE, words, compact=True)

    feed = {
        "generated": iso(now),
        "embedder": embedder,
        "clips": len(window),
        "stories": stories,
        "digest": digest,
        "framing": framing.top_words(words),
    }
    save_json(args.out, feed, compact=True)
    if not args.mock:
        save_json(config.SEARCH_FILE, {"generated": feed["generated"], "stories": everything}, compact=True)

    multi = sum(1 for s in stories if not s["single"])
    regions = sum(1 for s in stories if sum(1 for n in s["coverage"].values() if n) > 1)
    print(f"[run] embedder={embedder} clips={len(window)} stories={len(stories)} multi-outlet={multi} multi-region={regions} "
          f"quota_units={youtube.QuotaUsed.units}")
    if not args.mock:
        print(f"[run] channels ok={log['channels_ok']} new clips={log['new']} shapes asked={log['shapes']} rejected={dict(log['rejected'])}")
        if log["channels_missing"]:
            print(f"[run] WARNING handles not found, fix them in channels.json: {', '.join(log['channels_missing'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
