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


def uploads_since(uploads_playlist: str, since: str) -> list[str]:
    """Every upload published at or after `since` (ISO time), newest first: 1 unit per 50. For pipeline.backfill."""
    ids, token = [], None
    while True:
        data = _get("playlistItems", part="contentDetails", playlistId=uploads_playlist, maxResults=50,
                    **({"pageToken": token} if token else {}))
        for it in data.get("items", []):
            if it["contentDetails"].get("videoPublishedAt", "") < since:
                return ids
            ids.append(it["contentDetails"]["videoId"])
        token = data.get("nextPageToken")
        if not token:
            return ids


def video_details(ids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(ids), 50):
        batch = ids[i:i + 50]
        data = _get("videos", part="snippet,contentDetails,status", id=",".join(batch), maxResults=50)
        out.extend(data.get("items", []))
    return out


def is_wide(video_id: str) -> bool | None:
    """True for a widescreen clip, False for an upright one, None when the question should be asked again later.
    YouTube's oEmbed needs no key and costs no quota: asked with the /shorts/ address it answers 113x200 for a Short
    and 200x113 for anything else (asked with watch?v= it always answers 200x113)."""
    # ponytail: this is "is it a Short", not the true shape, so an upright video over 3 minutes counts as wide.
    # The Data API's `player` part with maxHeight gives the real size, in the call video_details already pays for.
    try:
        r = requests.get("https://www.youtube.com/oembed", timeout=10,
                         params={"format": "json", "url": f"https://www.youtube.com/shorts/{video_id}"})
        if r.status_code in (400, 401, 403, 404):
            return False        # YouTube won't say for this video: it keeps the full box, as before
        if r.status_code != 200:
            return None
        size = r.json()
        return size["width"] > size["height"]
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return None


_DUR = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def parse_duration(iso: str) -> int:
    """ISO 8601 duration (PT1M5S) -> seconds. Unknown/live -> 0."""
    m = _DUR.fullmatch(iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s
