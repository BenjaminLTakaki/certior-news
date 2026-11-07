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
    assert feed["digest"] and all(s["first"] <= s["updated"] for s in feed["stories"])
    for s in feed["stories"]:
        cols = [c["column"] for c in s["clips"]]
        if s["topic"] != "sports":
            assert cols == mixed(cols), "swipes must run left, center, right, left, center, right..., then off the scale"
        outlets = [c["channel"] for c in s["clips"]]
        assert len(outlets) == len(set(outlets)), "swiping sideways must always show another outlet"


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
        ("Bomb threats cause major flight disruptions across Europe • FRANCE 24 English", "FRANCE 24 English"): "Bomb threats cause major flight disruptions across Europe",
        ("Students blockade schools, universities as France braces for mass rallies •", "FRANCE 24 English"): "Students blockade schools, universities as France braces for mass rallies",
        ("France • Germany • Italy", "X"): "France • Germany • Italy",
    }
    for (title, channel), want in cases.items():
        assert grouping.clean_title(title, channel) == want, title
    # the short form an outlet also signs with, from channels.json
    f24 = next(c for c in json.loads((config.CHANNELS_FILE).read_text(encoding="utf-8"))["channels"] if c["name"] == "FRANCE 24 English")
    assert grouping.clean_title("US midterms bring surge of historic firsts • FRANCE 24", f24["name"], f24["aliases"]) == "US midterms bring surge of historic firsts"
    assert grouping.clean_title("Inside FRANCE 24's newsroom", f24["name"], f24["aliases"]) == "Inside FRANCE 24's newsroom"


def test_story_headline_is_calm_and_plain():
    def headline(story, others=()):
        """story: (channel, title, column) for each clip of the story, which is the first. others: (channel, title) one-clip stories
        elsewhere in the window. Every clip is as close to the story as the next, so ties go to the first."""
        window = [clip(i, ch, "europe", t, column=col) for i, (ch, t, col) in enumerate(story)]
        window += [clip(len(window) + i, ch, "europe", t) for i, (ch, t) in enumerate(others)]
        groups = [list(range(len(story)))] + [[len(story) + i] for i in range(len(others))]
        stories = grouping.build_stories(window, groups, np.eye(len(window)), NOW, capped=False)
        return next(s["headline"] for s in stories if s["id"] == "s_c0")

    # shouting loses to a calm title, even from another side, when the window has "diverted" and "threats" in normal case
    assert headline([("Fox", "Multiple EU flights DIVERTED after bomb THREATS", "center"), ("CBC", "Bomb threats force flights to land", "left")],
                    others=[("W", "Flight diverted to Rome"), ("W", "Wave of threats")]) == "Bomb threats force flights to land"
    # an acronym isn't shouting
    assert headline([("NDTV", "NDTV reports record turnout", "center"), ("CNN", "Record turnout reported in Bihar", "left")]) == "NDTV reports record turnout"
    # a kicker is cut
    assert headline([("GB", "BREAKING: Russell Brand found guilty", "center")]) == "Russell Brand found guilty"
    assert headline([("Fox", "SEE IT: Tornado hits airport", "center")]) == "Tornado hits airport"
    # a label an outlet opens many titles with loses; once, or a dateline several outlets use, it's just a title
    vance = [("WION", "US Midterm Elections: Vance blames Iran war for losses", "center"), ("AP", "Vance blames Iran war for midterm losses", "left")]
    assert headline(vance, others=[("WION", "US Midterm Elections: Senate flips"), ("WION", "US Midterm Elections: Texas turns blue")]) == "Vance blames Iran war for midterm losses"
    assert headline(vance) == "US Midterm Elections: Vance blames Iran war for losses"
    anc = [("WION", "South Africa: ANC loses ground in local polls", "center"), ("SABC", "Voters queue in Soweto", "unrated")]
    assert headline(anc, others=[("DW", "South Africa: Ramaphosa votes"), ("AJ", "South Africa: Counting begins")]) == "South Africa: ANC loses ground in local polls"


def test_an_outlet_keeps_only_its_newest_clip_in_a_story():
    old, new = clip(0, "CBC", "americas", "Brand trial begins"), clip(1, "CBC", "americas", "Brand found guilty")
    old["published"] = "2026-11-05T08:00:00Z"
    story = grouping.build_stories([old, new, clip(2, "Fox", "americas")], [[0, 1, 2]], np.eye(3), NOW)[0]
    assert [c["title"] for c in story["clips"] if c["channel"] == "CBC"] == ["Brand found guilty"]


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


# --------------------------------------------------------------------------- recap: the daily digest
def story(sid, clips, score, first="2026-11-05T08:00:00Z", single=False, outlets=3):
    cols = ["left", "center", "right"]
    return {"id": sid, "headline": sid, "topic": "politics", "first": first, "single": single, "coverage": {"europe": outlets},
            "sides": {}, "score": score, "clips": [{"id": c, "column": cols[k % 3], "channel": f"O{k}", "title": f"{sid} {k}"} for k, c in enumerate(clips)]}


def test_digest_keeps_each_story_once_at_its_peak():
    d = run.update_digest([], [story("a", ["x", "y"], 9, outlets=5)], NOW)
    d = run.update_digest(d, [story("a2", ["y", "z"], 4), story("one", ["q"], 99, single=True)], NOW)    # same story, new id
    assert len(d) == 1 and d[0]["score"] == 9 and d[0]["outlets"] == 5 and d[0]["clips"] == ["x", "y", "z"] and d[0]["headline"] == "a2"


def test_digest_shows_one_headline_per_side_not_a_summary():
    e = run.update_digest([], [story("a", ["x", "y", "z", "w"], 9)], NOW)[0]
    assert e["by_side"] == {"left": {"channel": "O0", "title": "a 0"}, "center": {"channel": "O1", "title": "a 1"},
                            "right": {"channel": "O2", "title": "a 2"}}
    assert "summary" not in e


def test_digest_keeps_a_week_and_each_days_biggest_stories(monkeypatch):
    monkeypatch.setattr(config, "DIGEST_PER_DAY", 2)
    old = [{**story("old", ["o"], 50), "day": "2026-10-29", "outlets": 9, "clips": ["o"]}]
    new = [story(f"s{i}", [f"c{i}"], 10 - i, first=f"2026-11-0{4 + i % 2}T08:00:00Z", outlets=3 + i) for i in range(6)]
    new.append(story("tabloid", ["t"], 99, first="2026-11-05T08:00:00Z", outlets=2))      # top score, too few outlets
    d = run.update_digest(old, new, NOW)
    assert [(e["day"], e["headline"], e["outlets"]) for e in d] == [
        ("2026-11-05", "s5", 8), ("2026-11-05", "s3", 6), ("2026-11-04", "s4", 7), ("2026-11-04", "s2", 5)]


def test_round_ups_of_several_stories_are_not_clips():
    for title in ("Unions Hold National Day Of Strike Across French Cities + More | Around The World In 5",
                  "05/11 6PM GMT - 5 Top Stories", "Around the World in 120 Seconds | GRAVITAS Worldview"):
        assert filters.to_clip(raw(snippet__title=title), CH, NOW)[0] is None, title
    assert filters.to_clip(raw(snippet__title="Top stories of the Senate race in Ohio"), CH, NOW)[0] is not None


# --------------------------------------------------------------------------- framing words
from pipeline import framing  # noqa: E402


def framed(stories):
    """stories: list of [(channel, column, title), ...] -> (clips, groups)."""
    clips, groups = [], []
    for s in stories:
        groups.append([])
        for ch, col, title in s:
            groups[-1].append(len(clips))
            clips.append({**clip(len(clips), ch, "europe", title=title, column=col), "id": f"k{len(clips)}"})
    return clips, groups


L = [f"Left{i}" for i in range(6)]
R = [f"Right{i}" for i in range(6)]


def test_a_word_many_left_outlets_use_for_shared_stories_is_framing(monkeypatch):
    monkeypatch.setattr(config, "FRAMING_MIN_Z", 2.0)
    stories = [[(ch, "left", f"Protesters march in city{k} over cuts") for ch in L] +
               [(ch, "right", f"Rioters march in city{k} over cuts") for ch in R] for k in range(8)]
    top = framing.top_words(framing.observe({}, *framed(stories)))
    assert [w["word"] for w in top["left"]][:1] == ["protester"] and [w["word"] for w in top["right"]][:1] == ["rioter"]
    assert top["stories"] == 8 and top["headlines"] == 8 * 12


def test_one_prolific_outlet_or_one_sided_stories_are_not_framing():
    # one outlet's habit gets past z = 3 here (20 stories), but it isn't its side's
    one_outlet = [[("Left0", "left", f"Shocking scenes in town{k}"), ("Left1", "left", f"Scenes in town{k}")] +
                  [(ch, "right", f"Scenes in town{k}") for ch in R] for k in range(20)]
    one_side = [[(ch, "left", f"Heatwave grips region{k}") for ch in L] for k in range(8)]
    top = framing.top_words(framing.observe({}, *framed(one_outlet + one_side)))
    assert top["left"] == [] and top["stories"] == 20


def test_framing_state_is_rebuilt_for_new_clips_and_kept_a_week():
    clips, groups = framed([[("Left0", "left", "Strike shuts ports"), ("Right0", "right", "Strike shuts ports")]])
    state = framing.observe({"old": {"day": "2026-10-01", "side": "left", "channel": "X", "story": "o", "words": ["a"]}}, clips, groups)
    assert framing.observe(state, clips, groups) == state       # the same window twice counts once
    assert set(framing.prune(state, NOW)) == {"k0", "k1"}


# --------------------------------------------------------------------------- backfill: fill Recap's week at once
from pipeline import backfill  # noqa: E402


def test_uploads_since_pages_back_and_stops_at_the_cutoff(monkeypatch):
    pages = {None: (["2026-11-05", "2026-11-04"], "p2"), "p2": (["2026-11-03", "2026-10-20"], "p3"), "p3": (["2026-10-01"], None)}
    calls = []
    def get(endpoint, **params):
        calls.append(params.get("pageToken"))
        days, nxt = pages[params.get("pageToken")]
        return {"items": [{"contentDetails": {"videoId": d, "videoPublishedAt": d + "T10:00:00Z"}} for d in days], "nextPageToken": nxt}
    monkeypatch.setattr(youtube, "_get", get)
    assert youtube.uploads_since("UU1", "2026-10-30T00:00:00Z") == ["2026-11-05", "2026-11-04", "2026-11-03"]
    assert calls == [None, "p2"]        # never pays for the page past the cutoff


def test_backfill_fills_past_days_without_keeping_old_clips(monkeypatch, tmp_path):
    for name in ("CLIPS_FILE", "REJECTED_FILE", "CHANNEL_CACHE_FILE", "DIGEST_FILE", "FRAMING_FILE"):
        monkeypatch.setattr(config, name, tmp_path / f"{name}.json")
    chans = json.loads(config.CHANNELS_FILE.read_text(encoding="utf-8"))["channels"]
    pick = [next(c for c in chans if config.column_of(c) == col) for col in ("left", "left", "right")]
    pick[1] = [c for c in chans if config.column_of(c) == "left"][1]
    run.save_json(config.CHANNEL_CACHE_FILE, {c["handle"]: {"uploads": c["handle"]} for c in pick})
    today = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    items = {}
    for d in (3, 2):
        for k, c in enumerate(pick):
            when = (today - timedelta(days=d, minutes=10 * k)).isoformat().replace("+00:00", "Z")
            items[f"v{d}{k}"] = (c["handle"], {**raw(snippet__publishedAt=when, snippet__title={3: "Volcano erupts in Iceland forcing evacuations", 2: "Ferry sinks off Greek coast with dozens missing"}[d]), "id": f"v{d}{k}"})
    monkeypatch.setattr(youtube, "uploads_since", lambda pl, since: [v for v, (h, _) in items.items() if h == pl])
    monkeypatch.setattr(youtube, "video_details", lambda ids: [items[v][1] for v in ids])
    assert backfill.main(["--days", "5"]) == 0
    digest = run.load_json(config.DIGEST_FILE, [])
    assert {e["day"] for e in digest} == {(today - timedelta(days=d)).strftime("%Y-%m-%d") for d in (3, 2)}
    assert all(e["outlets"] == 3 for e in digest)
    assert len(run.load_json(config.FRAMING_FILE, {})) == 6       # each outlet once per story, both days
    assert not config.CLIPS_FILE.exists()


def mixed(cols):
    """The swipe order for these columns: rounds of left, center, right, then the rest in config order."""
    sides = ("left", "center", "right")
    n = {c: cols.count(c) for c in config.COLUMNS}
    rounds = [c for r in range(max(n[c] for c in sides)) for c in sides if r < n[c]]
    return rounds + [c for c in config.COLUMNS if c not in sides for _ in range(n[c])]


def test_swipes_mix_the_sides_and_open_each_side_on_its_most_different_headline():
    titles = {0: ("A", "left", [1, 0, 0]), 1: ("B", "left", [0, 1, 0]), 2: ("C", "left", [.9, .1, 0]),
              3: ("D", "center", [1, 0, 0]), 4: ("E", "right", [0, 0, 1]), 5: ("F", "right", [.95, 0, .05]),
              6: ("G", "unrated", [1, 0, 0])}
    clips = [{**clip(i, ch, "europe", title=f"Volcano erupts, report {i}", column=col),
              "published": (NOW - timedelta(minutes=i)).isoformat().replace("+00:00", "Z")} for i, (ch, col, _) in titles.items()]
    X = np.array([v for _, _, v in titles.values()], dtype=float)
    X = X / np.linalg.norm(X, axis=1, keepdims=True)
    s = grouping.build_stories(clips, [list(range(7))], X, NOW)[0]
    order = [c["channel"] for c in s["clips"]]
    assert [c["column"] for c in s["clips"]] == ["left", "center", "right", "left", "right", "left", "unrated"]
    head = next(c for c in s["clips"] if c["title"] == s["headline"])["channel"]
    assert head in ("A", "D", "G")                  # the plain [1, 0, 0] headline...
    assert order[0] == "B" and order[2] == "E"      # ...so each side opens on the clip least like it
    assert order.index("C") > order.index("B")      # and "C", close to the headline, waits


def test_state_funded_outlets_leave_the_left_right_scale():
    state = {"name": "AJ", "region": "mideast_africa", "country": "Qatar", "lean": "lean-left",
             "note": "Al Jazeera is funded in whole or in part by the Qatari government."}
    public = {"name": "DW", "region": "europe", "country": "Germany", "lean": "lean-left", "note": "DW is a German public broadcast service."}
    out = run.apply_channels({"a": {"channel": "AJ"}, "b": {"channel": "DW"}}, [state, public])
    assert out["a"]["column"] == "state" and out["a"]["lean"] == "lean-left" and out["b"]["column"] == "left"
    assert filters.to_clip(raw(), state, NOW)[0]["column"] == "state"
    chans = json.loads(config.CHANNELS_FILE.read_text(encoding="utf-8"))["channels"]
    assert {c["name"] for c in chans if config.column_of(c) == "state"} == {
        "Al Jazeera English", "Al Arabiya English", "Arab News", "TeleSUR English", "SABC News", "euronews", "africanews"}


def test_state_funded_clips_come_after_the_sides_and_dont_count_as_one():
    cols = ["state", "left", "right", "unrated", "state", "center"]
    clips = [clip(i, f"O{i}", "europe", title=f"Ferry sinks, report {i}", column=col) for i, col in enumerate(cols)]
    s = grouping.build_stories(clips, [list(range(6))], np.eye(6), NOW)[0]
    assert [c["column"] for c in s["clips"]] == ["left", "center", "right", "state", "state", "unrated"]
    assert s["sides"]["state"] == 2 and s["blindspot"] is None
