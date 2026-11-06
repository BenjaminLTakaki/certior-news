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
CH = {"name": "CNN", "region": "americas", "country": "US", "lean": "lean-left"}


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
    assert why == "" and clip["region"] == "americas" and clip["column"] == "left" and clip["duration"] == 45
    assert "Subscribe" not in clip["desc"]


def test_filter_rejections():
    cases = {
        "embedding disabled": raw(status__embeddable=False),
        "live": raw(snippet__liveBroadcastContent="live"),
        "duration": raw(contentDetails__duration="PT6M"),
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
    order = {c: i for i, c in enumerate(config.COLUMNS)}
    for s in feed["stories"]:
        cols = [order[c["column"]] for c in s["clips"]]
        assert cols == sorted(cols), "clips must run left, center, right, unrated"
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
    chans = [{"name": "CNN", "handle": "@CNN", "region": "americas", "country": "US", "lean": "lean-left"},
             {"name": "Nope", "handle": "@missing", "region": "asia", "country": "Japan", "lean": "center"}]
    log = run.fetch(chans, store, rejected, cache, NOW)
    assert calls == [["v1", "v2"]]               # already-stored IDs are not paid for again
    assert "v1" in store and "v2" in rejected
    assert log["channels_missing"] == ["Nope (@missing)"] and "@CNN" in cache


def clip(i, channel, region, title="t", column="center"):
    return {"id": f"c{i}", "title": title, "channel": channel, "country": "", "region": region, "lean": column,
            "column": column, "published": NOW.isoformat().replace("+00:00", "Z"), "duration": 60}


def test_multi_region_story_outranks_bigger_single_region_story():
    clips = [clip(0, "A", "americas"), clip(1, "B", "americas"), clip(2, "C", "americas"), clip(3, "D", "americas"),
             clip(4, "E", "europe"), clip(5, "F", "asia")]
    stories = grouping.build_stories(clips, [[0, 1, 2, 3], [4, 5]], np.eye(6), NOW)
    assert stories[0]["coverage"]["europe"] == 1 and stories[0]["coverage"]["asia"] == 1


def test_channels_file_decides_outlets_and_regions():
    store = {"a": {"channel": "BBC", "region": "old"}, "b": {"channel": "Gone", "region": "old"}}
    out = run.apply_channels(store, [{"name": "BBC", "region": "europe", "country": "UK", "lean": "center"}])
    assert list(out) == ["a"] and out["a"]["region"] == "europe" and out["a"]["country"] == "UK" and out["a"]["column"] == "center"
    assert out["a"]["note"] == ""


def test_funding_note_reaches_the_feed():
    c = {**clip(0, "A", "europe"), "note": "A is funded by B."}
    assert grouping.build_stories([c], [[0]], np.eye(1), NOW)[0]["clips"][0]["note"] == "A is funded by B."


def test_at_most_one_us_story_in_every_four_until_world_stories_run_out():
    def story(n):
        return [clip(n * 2, f"A{n}", "europe", f"Republicans lose seat {n}"), clip(n * 2 + 1, f"B{n}", "asia", f"Republicans lose seat {n}")]
    us = [c for n in range(5) for c in story(n)]
    world = [clip(10 + i, f"W{i}", "europe", f"Sudan talks {i}") for i in range(4)]
    groups = [[n * 2, n * 2 + 1] for n in range(5)] + [[10 + i] for i in range(4)]
    stories = grouping.build_stories(us + world, groups, np.eye(14), NOW)
    assert [s["us_domestic"] for s in stories] == [False, False, False, True, False, True, True, True, True]


def test_us_domestic_terms_leave_other_countries_alone():
    assert grouping.is_us_domestic(["Republicans lose the Senate", "Michigan too close to call"])
    assert grouping.is_us_domestic(["Morning again in America after blue wave", "JD Vance trolled over Senate win"])
    assert not grouping.is_us_domestic(["Nigerian governor sworn in", "India's Congress party wins state vote"])
    assert not grouping.is_us_domestic(["Latin American leaders meet in Bogota"])


def test_one_big_event_does_not_snowball_into_one_story(monkeypatch):
    monkeypatch.setattr(config, "MIN_SHARED_KEYWORDS", 0)
    # every neighbour is close, but the two ends of the chain are not: they must not share a story
    v = np.array([[1, 0, 0], [.9, .43, 0], [.65, .75, 0], [.3, .95, 0]], dtype=np.float32)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    clips = [clip(i, f"O{i}", "europe", "Midterms update seat race") for i in range(4)]
    _, groups, _ = grouping.group(clips, 0.8, ("x", v))
    assert sorted(sorted(g) for g in groups) == [[0, 1], [2, 3]]


def test_clean_title_drops_outlet_tags_but_keeps_the_story():
    cases = {
        ("Abdul El-Sayed: The US' first Muslim senator | DW News", "DW News"): "Abdul El-Sayed: The US' first Muslim senator",
        ("Key moments as Democrats sweep to victories in US midterms | AJ #shorts", "Al Jazeera English"): "Key moments as Democrats sweep to victories in US midterms",
        ("Republicans in Texas shocked by midterm results. #BBCNews", "BBC News"): "Republicans in Texas shocked by midterm results.",
        ("How Trump's promises handed Democrats the midterms FRANCE 24 English", "FRANCE 24 English"): "How Trump's promises handed Democrats the midterms",
        ("United States | Democrats lead elections", "TeleSUR English"): "United States | Democrats lead elections",
        ("#shorts", "X"): "#shorts",
    }
    for (title, channel), want in cases.items():
        assert grouping.clean_title(title, channel) == want, title


def test_same_clip_reposted_by_an_outlet_appears_once():
    clips = [clip(0, "A", "europe", "Same title"), clip(1, "A", "europe", "same TITLE"), clip(2, "B", "asia", "Other")]
    story = grouping.build_stories(clips, [[0, 1, 2]], np.eye(3), NOW)[0]
    assert len(story["clips"]) == 2


def test_topics_on_labelled_real_stories():
    rows = json.loads((Path(__file__).parent / "fixtures" / "topic_labels.json").read_text(encoding="utf-8"))
    pred = [grouping.topic_of([{"title": t} for t in r["titles"]]) for r in rows]
    for topic, min_precision, min_recall in (("politics", 0.9, 0.75), ("sports", 0.9, 0.9)):
        hit = sum(p == topic and r["topic"] == topic for p, r in zip(pred, rows))
        assert hit / max(1, pred.count(topic)) >= min_precision, topic
        assert hit / sum(r["topic"] == topic for r in rows) >= min_recall, topic


def test_topic_keywords_avoid_their_known_traps():
    assert grouping.topic_of([{"title": "Wall Street stocks rally after the jobs report"}]) == "other"
    assert grouping.topic_of([{"title": "Your hydro bill is going up"}]) == "other"
    assert grouping.topic_of([{"title": "Senate race too close to call"}]) == "politics"
    assert grouping.topic_of([{"title": "Alligator strolls into Florida bagel shop"}]) == "other"
    assert grouping.topic_of([{"title": "Mississippi too close to call"}]) == "politics"


def test_tags_can_overlap_and_avoid_known_traps():
    tags = lambda t: grouping.tags_of([{"title": t}], grouping.topic_of([{"title": t}]))
    assert "tech" in tags("New limits on AI and screen time in schools")
    assert {"tech", "business"} <= set(tags("AI shares slide as stock markets fall"))
    assert "business" not in tags("Cyberattack hits French blood bank fridges")
    assert "business" not in tags("Korean kidswear goes viral at Seoul's Namdaemun Market")
    assert "business" not in tags("IDF arrests West Bank terror cells")
    assert "science" not in tags("Netflix show returns with humor and heart")
    assert "science" in tags("WHO approves clinical trials on two new Ebola vaccines")
    assert "science" in tags("Meteorite spotted over Singapore was space debris, NASA says")
    assert "tech" not in tags("Meteorite spotted over Singapore was space debris, NASA says")
    assert "crime" not in tags("Police clash with students at the march")
    assert "tech" not in tags("Minister said the plan is fine")     # "ai" is in "said"
    assert "science" in tags("COP31 in Antalya aims to turn climate ambition into action")
    assert "crime" in tags("Russell Brand found guilty of rape")
    assert "disasters" in tags("Tornado strikes Brazil airport")
    assert tags("Liverpool stun Real Madrid in the Champions League") == ["sports"]


def test_specialist_outlet_always_tags_its_subject():
    assert "culture" in grouping.tags_of([{"title": "The looks everyone is talking about", "tags": ["culture"]}], "other")
    assert grouping.tags_of([{"title": "Parliament votes on the budget", "tags": ["business"]}], "politics")[:1] == ["politics"]


def test_sports_outlet_makes_a_sports_story_without_left_right_labels():
    clips = [{**clip(i, f"S{i}", "europe", "Big transfer agreed", column="unrated"), "topic": "sports"} for i in range(3)]
    story = grouping.build_stories(clips, [[0, 1, 2]], np.eye(3), NOW)[0]
    assert story["topic"] == "sports" and story["blindspot"] is None and story["us_domestic"] is False


def test_sports_stories_survive_a_full_news_feed(monkeypatch):
    monkeypatch.setattr(config, "MAX_STORIES_IN_FEED", 2)
    clips = [clip(i, f"N{i}", "europe", f"Parliament votes on law {i}") for i in range(5)] + [{**clip(5, "S", "europe", "Cup final"), "topic": "sports"}]
    stories = grouping.build_stories(clips, [[i] for i in range(6)], np.eye(6), NOW)
    assert [s["topic"] for s in stories].count("politics") == 2 and [s["topic"] for s in stories].count("sports") == 1
    assert len(grouping.build_stories(clips, [[i] for i in range(6)], np.eye(6), NOW, capped=False)) == 6     # search keeps everything


def test_blindspot_when_one_side_skips_a_story():
    clips = [clip(0, "A", "europe", column="left"), clip(1, "B", "asia", column="left"), clip(2, "C", "asia", column="center")]
    assert grouping.build_stories(clips, [[0, 1, 2]], np.eye(3), NOW)[0]["blindspot"] == "right"
    clips[2] = clip(2, "C", "asia", column="right")
    assert grouping.build_stories(clips, [[0, 1, 2]], np.eye(3), NOW)[0]["blindspot"] is None


# ---- second pass (merge_split). Embeddings are given, so these check the rules; `python -m pipeline.tune merges`
# scores the real model on a real window (tests/fixtures/real_window.json.gz).
BACKGROUND = ["Trump touts ballroom after midterm loss", "Republicans react to midterm loss as Trump blames turnout",
              "Trump says midterm loss was the way the ball bounces", "Iran mocks Trump over midterm loss",
              "Tornado strikes Brazil airport", "Cyberattack hits French blood bank fridges"]


def merge(stories, vecs, hours_ago=None, background=BACKGROUND):
    """stories: list of lists of titles. vecs: one embedding per story (all its clips get it). Background stories are far
    from everything, so they only make their words common."""
    clips, groups, X = [], [], []
    for s, (titles, v) in enumerate(zip(stories + [[t] for t in background], vecs + [None] * len(background))):
        groups.append([])
        for t in titles:
            groups[-1].append(len(clips))
            clips.append({"title": t, "channel": f"O{len(clips)}", "desc": ""})
            X.append(v if v is not None else np.eye(16)[4 + len(X) % 12])
    X = np.array(X, dtype=np.float32)
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    ago = (hours_ago or [0] * len(stories)) + [0] * len(background)
    hours = np.array([-ago[s] for s, g in enumerate(groups) for _ in g], dtype=float)
    owner = {c: s for s, g in enumerate(groups) for c in g}
    return [sorted({owner[c] for c in o}) for o in grouping.merge_split(clips, groups, X, "bge-base", hours)]


def vec(*xs):
    return np.array(list(xs) + [0] * (16 - len(xs)), dtype=np.float32)


def test_second_pass_joins_a_story_the_first_pass_split():
    ronaldo = [["Cristiano Ronaldo retires from international football"] * 2,
               ["'Portugal will always be a part of me': Cristiano Ronaldo retires from international football"]]
    assert [0, 1] in merge(ronaldo, [vec(1, 0), vec(.75, .66)])


def test_second_pass_ignores_words_every_story_has():
    # close embeddings, but "Trump", "midterm" and "loss" are in many stories: these are two different events
    banner = [["Tehran crowds torch Trump banner after midterm loss"] * 3, ["Trump touts ballroom after midterm loss"] * 3]
    assert [0, 1] not in merge(banner, [vec(1, 0), vec(.75, .66)])


def test_second_pass_does_not_snowball():
    # every story shares the same specific words, and each is close to the next, but the two ends are not
    chain = [["Hegseth impeachment articles filed in Congress"] * 3] * 3
    out = merge(chain, [vec(1, 0), vec(.8, .6), vec(.3, .95)])
    assert [0, 1, 2] not in out


def test_two_small_stories_need_more_in_common():
    coopers = [["Democrat Roy Cooper celebrates victory in North Carolina"] * 2, ["This is a common-sense win for Republicans: Brett Cooper"]]
    assert [0, 1] not in merge(coopers, [vec(1, 0), vec(.9, .43)])


def test_second_pass_keeps_stories_days_apart():
    same = [["Paraguay president resigns after Ueno bank collapse"] * 3] * 2
    assert [0, 1] in merge(same, [vec(1, 0), vec(1, 0)])
    assert [0, 1] not in merge(same, [vec(1, 0), vec(1, 0)], hours_ago=[0, config.STORY_GAP_HOURS + 1])
