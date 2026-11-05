"""Turn raw YouTube video resources into clean clip records, or reject them."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from . import config
from .youtube import parse_duration

_BLOCK = [re.compile(p, re.I) for p in config.BLOCKLIST]
_URL = re.compile(r"https?://\S+")
_HASHTAG = re.compile(r"#\w+")
_BOILER = re.compile(
    r"(subscribe|follow us|download the|watch more|sign up|newsletter|for more|visit|"
    r"facebook|instagram|twitter|tiktok|x\.com|app store|google play|merch|sponsor|promo code)",
    re.I,
)


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def clean_description(desc: str, limit: int = 300) -> str:
    """Keep only the newsy part of a description: drop links, hashtags and boilerplate lines."""
    keep = []
    for line in (desc or "").splitlines():
        line = _HASHTAG.sub("", _URL.sub("", line)).strip(" -–—•|»")
        if not line or _BOILER.search(line):
            continue
        keep.append(line)
    text = " ".join(keep)
    return text[:limit]


def to_clip(item: dict, channel: dict, now: datetime | None = None) -> tuple[dict | None, str]:
    """Returns (clip, "") if accepted, else (None, reason)."""
    now = now or datetime.now(timezone.utc)
    sn, cd, st = item.get("snippet", {}), item.get("contentDetails", {}), item.get("status", {})
    title = (sn.get("title") or "").strip()

    if sn.get("liveBroadcastContent", "none") != "none":
        return None, "live"
    if st.get("privacyStatus") != "public":
        return None, "not public"
    if not st.get("embeddable", False):
        return None, "embedding disabled"
    if (cd.get("contentRating") or {}).get("ytRating") == "ytAgeRestricted":
        return None, "age restricted"
    dur = parse_duration(cd.get("duration", ""))
    if not (config.MIN_DURATION_S <= dur <= config.MAX_DURATION_S):
        return None, f"duration {dur}s"
    published = parse_time(sn["publishedAt"])
    age_h = (now - published).total_seconds() / 3600
    if age_h > config.MAX_AGE_HOURS:
        return None, "too old"
    for rx in _BLOCK:
        if rx.search(title):
            return None, f"blocklist: {rx.pattern}"

    return {
        "id": item["id"],
        "title": title,
        "desc": clean_description(sn.get("description", "")),
        "channel": channel["name"],
        "topic": channel.get("topic", ""),
        "tags": channel.get("tags", []),
        "lean": channel["lean"],
        "column": config.LEAN_TO_COLUMN[channel["lean"]],
        "region": channel["region"],
        "country": channel["country"],
        "published": sn["publishedAt"],
        "duration": dur,
    }, ""
