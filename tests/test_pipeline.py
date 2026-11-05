import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

os.environ["EMBEDDER"] = "tfidf"   # tests never download a model

from pipeline import config, filters, grouping, run, youtube  # noqa: E402
from pipeline.tune import pair_scores  # noqa: E402

FIX = Path(__file__).parent / "fixtures" / "sample_clips.json"
NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
CH = {"name": "CNN", "region": "americas", "country": "US"}


def raw(**over):
    item = {
        "id": "abc123",
        "snippet": {"title": "Senate passes stopgap bill", "description": "Text\nSubscribe: https://x.y",
                    "publishedAt": (NOW - timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
                    "liveBroadcastContent": "none"},
        "contentDetails": {"duration": "PT45S"},
        "status": {"privacyStatus": "public", "embeddable": True},
    }
    for path, val in over.items():
        part, key = path.split("__")
        item[part][key] = val
    return item


def test_duration_parse():
    assert youtube.parse_duration("PT1M5S") == 65
    assert youtube.parse_duration("PT2H") == 7200
    assert youtube.parse_duration("P0D") == 0
    assert youtube.parse_duration("") == 0


def test_filter_accepts_short_news_clip():
    clip, why = filters.to_clip(raw(), CH, NOW)
    assert why == "" and clip["region"] == "americas" and clip["duration"] == 45
    assert "Subscribe" not in clip["desc"]


def test_filter_rejections():
    cases = {
        "embedding disabled": raw(status__embeddable=False),
        "live": raw(snippet__liveBroadcastContent="live"),
        "duration": raw(contentDetails__duration="PT4M"),
        "too old": raw(snippet__publishedAt="2026-11-01T00:00:00Z"),
        "blocklist": raw(snippet__title="FULL EPISODE: Tonight's show"),
        "not public": raw(status__privacyStatus="unlisted"),
    }
    for expected, item in cases.items():
        clip, why = filters.to_clip(item, CH, NOW)
        assert clip is None and why.startswith(expected), (expected, why)


def test_grouping_matches_fixture_without_wrong_merges():
    clips = sorted(run.load_mock(FIX, NOW).values(), key=lambda c: c["published"])
    _, groups, _ = grouping.group(clips)
    s = pair_scores([c["story"] for c in clips], groups)
    assert s["wrong_merges"] == 0
    assert s["recall"] >= 0.9


def test_two_different_shootings_stay_apart():
    clips = sorted(run.load_mock(FIX, NOW).values(), key=lambda c: c["published"])
    _, groups, _ = grouping.group(clips)
    for g in groups:
        stories = {clips[i]["story"] for i in g}
        assert not {"G1", "G2"} <= stories


def test_feed_shape(tmp_path):
    out = tmp_path / "feed.json"
    assert run.main(["--mock", str(FIX), "--out", str(out)]) == 0
    feed = json.loads(out.read_text())
    assert feed["stories"] and feed["clips"] == 40
    order = {r: i for i, r in enumerate(config.REGIONS)}
    for s in feed["stories"]:
        regions = [order[c["region"]] for c in s["clips"]]
        assert regions == sorted(regions), "clips must run region by region"
        per_outlet = {}
        for c in s["clips"]:
            per_outlet[c["channel"]] = per_outlet.get(c["channel"], 0) + 1
        assert max(per_outlet.values()) <= config.MAX_CLIPS_PER_OUTLET


def test_fetch_with_fake_api(monkeypatch):
    calls = []
    monkeypatch.setattr(youtube, "resolve_handle", lambda h: None if h == "@missing" else {"channel_id": "UC1", "uploads": "UU1", "title": h})
    monkeypatch.setattr(youtube, "latest_upload_ids", lambda pl, n: ["v1", "v2", "seen"])
    def details(ids):
        calls.append(list(ids))
        return [{**raw(), "id": "v1"}, {**raw(contentDetails__duration="PT10M"), "id": "v2"}]
    monkeypatch.setattr(youtube, "video_details", details)
    store, rejected, cache = {"seen": {}}, {}, {}
    chans = [{"name": "CNN", "handle": "@CNN", "region": "americas", "country": "US"},
             {"name": "Nope", "handle": "@missing", "region": "asia", "country": "Japan"}]
    log = run.fetch(chans, store, rejected, cache, NOW)
    assert calls == [["v1", "v2"]]               # already-stored IDs are not paid for again
    assert "v1" in store and "v2" in rejected
    assert log["channels_missing"] == ["Nope (@missing)"] and "@CNN" in cache


def test_multi_region_story_outranks_bigger_single_region_story():
    def clip(i, channel, region):
        return {"id": f"c{i}", "title": "t", "channel": channel, "country": "", "region": region,
                "published": NOW.isoformat().replace("+00:00", "Z"), "duration": 60}
    clips = [clip(0, "A", "americas"), clip(1, "B", "americas"), clip(2, "C", "americas"), clip(3, "D", "americas"),
             clip(4, "E", "europe"), clip(5, "F", "asia")]
    stories = grouping.build_stories(clips, [[0, 1, 2, 3], [4, 5]], np.eye(6), NOW)
    assert stories[0]["coverage"]["europe"] == 1 and stories[0]["coverage"]["asia"] == 1


def test_channels_file_decides_outlets_and_regions():
    store = {"a": {"channel": "BBC", "region": "old"}, "b": {"channel": "Gone", "region": "old"}}
    out = run.apply_channels(store, [{"name": "BBC", "region": "europe", "country": "UK"}])
    assert list(out) == ["a"] and out["a"]["region"] == "europe" and out["a"]["country"] == "UK"
