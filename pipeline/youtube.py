"""Thin client for the YouTube Data API v3 (only the cheap 1-unit calls)."""
from __future__ import annotations

import os
import re
import time

import requests

API = "https://www.googleapis.com/youtube/v3"


class QuotaUsed:
    units = 0


def _get(endpoint: str, **params) -> dict:
    key = os.environ.get("YT_API_KEY")
    if not key:
        raise RuntimeError("YT_API_KEY is not set. Add it as a repository secret (see README).")
    params["key"] = key
    for attempt in range(3):
        r = requests.get(f"{API}/{endpoint}", params=params, timeout=20)
        QuotaUsed.units += 1
        if r.status_code == 200:
            return r.json()
        if r.status_code in (500, 503) and attempt < 2:
            time.sleep(2 * (attempt + 1))
            continue
        raise RuntimeError(f"YouTube API {endpoint} failed ({r.status_code}): {r.text[:300]}")
    return {}


def resolve_handle(handle: str) -> dict | None:
    """@CNN -> {"channel_id": "UC...", "uploads": "UU..."}; None if the handle does not exist."""
    data = _get("channels", part="id,contentDetails,snippet", forHandle=handle)
    items = data.get("items") or []
    if not items:
        return None
    it = items[0]
    return {
        "channel_id": it["id"],
        "uploads": it["contentDetails"]["relatedPlaylists"]["uploads"],
        "title": it["snippet"]["title"],
    }


def latest_upload_ids(uploads_playlist: str, n: int) -> list[str]:
    data = _get("playlistItems", part="contentDetails", playlistId=uploads_playlist, maxResults=min(n, 50))
    return [it["contentDetails"]["videoId"] for it in data.get("items", [])]


def video_details(ids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(ids), 50):
        batch = ids[i:i + 50]
        data = _get("videos", part="snippet,contentDetails,status", id=",".join(batch), maxResults=50)
        out.extend(data.get("items", []))
    return out


_DUR = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def parse_duration(iso: str) -> int:
    """ISO 8601 duration (PT1M5S) -> seconds. Unknown/live -> 0."""
    m = _DUR.fullmatch(iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s
