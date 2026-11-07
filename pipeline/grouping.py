"""Group clips about the same event into stories.

Two clips can share a story only if BOTH:
  1. their title embeddings are close (cosine >= threshold), and
  2. they share at least one *distinctive* word (a word that is not common across the whole
     window), which stops "two different shootings" from merging.
Complete-linkage clustering holds EVERY pair in a story to that bar. Comparing clips to a story's
running average instead let one big event snowball: all the midterm clips became a single story.

That bar also splits one event into several stories when outlets word it differently, so a second
pass (merge_split) joins whole stories that are close AND share specific words across their titles
and descriptions. It is complete-linkage too, between stories, for the same reason.
"""
from __future__ import annotations

import math
import os
import re
import sys
from collections import Counter
from datetime import datetime

import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.text import TfidfVectorizer

from . import config

STOP = set("""
a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing down during each few for from further had has have having he her here hers him his
how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own
same she should so some such than that the their them then there these they this those through to too under until up
very was we were what when where which while who whom why will with would you your
news video videos watch live breaking update updates report reports says said say new latest today tonight just
clip shorts short full exclusive official story stories here what's whats it's dont don't us via amid after over
""".split())

_WORD = re.compile(r"[a-z0-9][a-z0-9'\-]*")


def tokens(text: str) -> list[str]:
    out = []
    for w in _WORD.findall(text.lower()):
        w = w.strip("'-")
        if w.endswith("'s"):
            w = w[:-2]
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]                      # tariffs -> tariff, crowds -> crowd
        if len(w) < 3 or w in STOP or w.isdigit():
            continue
        out.append(w)
    return out


_TAGS = re.compile(r"(\s*#\w+)+\s*$")
_TAIL = re.compile(r"^(.*?\S(?:\s+\S+){3,})\s*\|\s*(?:\S+(?:\s+\S+){0,3})\s*$")
_BULLET = re.compile(r"\s*[•·]\s*$")


def clean_title(title: str, channel: str = "", aliases=()) -> str:
    """Drop what outlets bolt onto titles ("| DW News", "#BBCNews", "• FRANCE 24 English", "• FRANCE 24"): it is noise to read
    and to compare. aliases = other names the outlet signs with (channels.json)."""
    t = title.strip()
    names = [n for n in (channel, *aliases) if n]
    for _ in range(3):      # "... | AJ #shorts" needs the hashtag gone before the tail can go
        before = t
        t = _TAGS.sub("", t)
        for name in names:
            t = re.sub(rf"[\s|:\-•·]*{re.escape(name)}\s*$", "", t, flags=re.I)
        t = _BULLET.sub("", t)
        m = _TAIL.match(t)
        t = m[1].rstrip() if m else t
        if t == before:
            break
    return t or title.strip()


def clip_text(c: dict) -> str:
    return clean_title(c["title"], c["channel"], c.get("aliases", ()))       # descriptions are mostly about the outlet, and pulled unrelated clips together


# --------------------------------------------------------------------------- embedders
def _tfidf(texts: list[str]) -> np.ndarray:
    vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, tokenizer=tokens,
                          token_pattern=None, lowercase=False)
    m = vec.fit_transform(texts).toarray().astype(np.float32)
    return _normalize(m)


def _normalize(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1
    return m / n


def embed(clips: list[dict]) -> tuple[str, np.ndarray]:
    """Returns (embedder name, L2-normalised matrix). Uses bge-base via fastembed when it can,
    TF-IDF otherwise (e.g. no internet for the model download). EMBEDDER=tfidf forces the fallback."""
    if os.environ.get("EMBEDDER", "").lower() != "tfidf":
        try:
            from fastembed import TextEmbedding
            model = TextEmbedding(model_name=config.EMBED_MODEL,
                                  cache_dir=os.environ.get("FASTEMBED_CACHE_PATH"))
            m = np.array(list(model.embed([clip_text(c) for c in clips])), dtype=np.float32)
            return "bge-base", _normalize(m)
        except Exception as e:  # noqa: BLE001 - any failure -> fallback, never break the feed
            print(f"[grouping] fastembed unavailable ({type(e).__name__}: {e}); using TF-IDF", file=sys.stderr)
    return "tfidf", _tfidf([f"{clip_text(c)}. {c.get('desc', '')}" for c in clips])     # word counts need more text than a title


# --------------------------------------------------------------------------- grouping
def group(clips: list[dict], threshold: float | None = None,
          embedded: tuple[str, np.ndarray] | None = None, merge: bool = True) -> tuple[str, list[list[int]], np.ndarray]:
    """Returns (embedder name, list of stories as lists of clip indexes, embedding matrix).
    Pass `embedded` to reuse embeddings and `merge=False` to skip the second pass (tuning)."""
    if len(clips) < 2:
        name, X = embedded or embed(clips) if clips else ("none", np.zeros((0, 1)))
        return name, [[i] for i in range(len(clips))], X
    name, X = embedded or embed(clips)
    th = config.THRESHOLDS[name] if threshold is None else threshold

    # distinctive words: appear in at most 15% of clips in the window
    docs = [set(tokens(f"{clip_text(c)}. {c.get('desc', '')}")) for c in clips]
    df = Counter(w for d in docs for w in d)
    cap = max(3, int(0.15 * len(clips)))
    kw = [{w for w in d if df[w] <= cap} for d in docs]
    hours = np.array([_ts(c["published"]) for c in clips]) / 3600

    # pairs that must never share a story sit past the cut, whatever their similarity
    D = np.clip(1 - X @ X.T, 0, 2)
    D = (D + D.T) / 2
    NEVER = 2.0
    D[np.abs(hours[:, None] - hours[None, :]) > config.STORY_GAP_HOURS] = NEVER
    for i, a in enumerate(kw):
        for j in range(i + 1, len(kw)):
            if len(a & kw[j]) < config.MIN_SHARED_KEYWORDS:
                D[i, j] = D[j, i] = NEVER
    np.fill_diagonal(D, 0)

    labels = AgglomerativeClustering(n_clusters=None, metric="precomputed", linkage="complete",
                                     distance_threshold=1 - th).fit_predict(D)
    stories = _join(labels, [[i] for i in range(len(clips))])
    return name, merge_split(clips, stories, X, name, hours) if merge else stories, X


def _join(labels, parts: list[list[int]]) -> list[list[int]]:
    out: dict[int, list[int]] = {}
    for label, part in zip(labels, parts):
        out.setdefault(int(label), []).extend(part)
    return list(out.values())


def merge_split(clips: list[dict], stories: list[list[int]], X: np.ndarray, name: str, hours: np.ndarray) -> list[list[int]]:
    """Join stories the first pass split: "France braces for nationwide strike" and "Students blockade schools as France braces
    for mass rallies". Two stories join only if ALL of these hold, and complete linkage holds every pair of stories in the result
    to them, so the midterms can't snowball into one story:
      - their average title embeddings are close (MERGE_SIMILARITY),
      - no clip in one is far from any clip in the other (MERGE_FLOOR),
      - their titles + descriptions share specific words (MERGE_MIN_WORDS; stricter for two small stories), with words that
        appear in many stories left out, so "midterms" and "Trump" alone don't count,
      - they had clips within STORY_GAP_HOURS of each other."""
    if len(stories) < 2 or name not in config.MERGE_SIMILARITY:
        return stories
    C = _normalize(np.stack([X[s].sum(axis=0) for s in stories]))
    docs = [" ".join(f"{clip_text(clips[i])}. {clips[i].get('desc', '')}" for i in s) for s in stories]
    cap = max(3, int(config.MERGE_COMMON_SHARE * len(stories)))
    vec = TfidfVectorizer(tokenizer=tokens, token_pattern=None, lowercase=False, sublinear_tf=True, max_df=cap)
    try:
        M = vec.fit_transform(docs)
    except ValueError:      # no word survives: nothing to go on
        return stories
    words = (M @ M.T).toarray()
    size = np.array([len(s) for s in stories])
    need = np.where(np.maximum(size[:, None], size[None, :]) < config.MERGE_SMALL_STORY, config.MERGE_MIN_WORDS_SMALL, config.MERGE_MIN_WORDS)
    lo, hi = np.array([hours[s].min() for s in stories]), np.array([hours[s].max() for s in stories])
    apart = np.maximum(lo[:, None] - hi[None, :], lo[None, :] - hi[:, None]) > config.STORY_GAP_HOURS
    nearest = np.stack([(X[s] @ X.T).min(axis=0) for s in stories])          # story x clip: least similar clip of the story
    floor = np.stack([nearest[:, s].min(axis=1) for s in stories], axis=1)    # story x story

    D = np.clip(1 - C @ C.T, 0, 2)
    D[(words < need) | apart | (floor < config.MERGE_FLOOR[name])] = 2.0
    np.fill_diagonal(D, 0)
    labels = AgglomerativeClustering(n_clusters=None, metric="precomputed", linkage="complete",
                                     distance_threshold=1 - config.MERGE_SIMILARITY[name]).fit_predict(D)
    return _join(labels, stories)


# --------------------------------------------------------------------------- feed building
COL_ORDER = {c: i for i, c in enumerate(config.COLUMNS)}
_US_DOMESTIC = re.compile(config.US_DOMESTIC, re.I)


_KICKER = re.compile(config.HEADLINE_KICKERS, re.I)
_LABEL = re.compile(r"^([^:|]{2,40}?)\s*[:|]\s+\S")     # "US Midterm Elections: Vance blames..." -> "US Midterm Elections"
_CAPS = re.compile(r"\b[A-Z]{4,}\b")


def headline(c: dict) -> str:
    return _KICKER.sub("", clip_text(c))       # "BREAKING:" goes; a clip's own title stays as the outlet wrote it


def headline_judge(clips: list[dict]):
    """Returns penalty(clip) for choosing a story's headline, worked out from the whole window. 1 for a series label: one an
    outlet opens many titles with ("US Midterm Elections:", "LGE 2026 |"). Counted per outlet, because "South Africa:" from
    several outlets is a dateline. A label is only avoided, never cut: "Ramayana Review:" is the subject. 1 for shouting: an
    all-caps word ("DIVERTED", "THREATS") that other titles have in normal case. Acronyms (NDTV, SCOTUS) never are."""
    labels = Counter((c["channel"], m[1].casefold()) for c in clips if (m := _LABEL.match(headline(c))))
    normal = {w.casefold() for c in clips for w in re.findall(r"\b[A-Za-z][a-z]{3,}\b", c["title"])}

    def penalty(c: dict) -> int:
        t = headline(c)
        m = _LABEL.match(t)
        series = bool(m) and labels[(c["channel"], m[1].casefold())] >= config.SERIES_LABEL_MIN
        return series + any(w.casefold() in normal for w in _CAPS.findall(t))
    return penalty


_SPORTS = re.compile(config.SPORTS_WORDS, re.I)
_POLITICS = re.compile(config.POLITICS_WORDS, re.I)


def _share_matches(rx: re.Pattern, titles: list[str]) -> bool:
    return sum(bool(rx.search(t)) for t in titles) >= config.US_DOMESTIC_SHARE * len(titles)


def is_us_domestic(titles: list[str]) -> bool:
    return _share_matches(_US_DOMESTIC, titles)


_TAGS_RX = {tag: re.compile(words, re.I) for tag, words in config.TAG_WORDS.items()}


def tags_of(clips: list[dict], topic: str) -> list[str]:
    titles = [c["title"] for c in clips]
    if topic == "sports":
        return ["sports"]       # "Fenerbahce stun Liverpool" isn't a business story because of "shares" in a description
    tags = ["politics"] if topic == "politics" else []
    tags += [tag for tag, rx in _TAGS_RX.items() if _share_matches(rx, titles)]
    for c in clips:         # a specialist outlet (Vogue, WIRED...) always puts its story in its subject's tab
        tags += [t for t in c.get("tags", []) if t not in tags]
    return tags


def topic_of(clips: list[dict]) -> str:
    titles = [c["title"] for c in clips]
    if any(c.get("topic") == "sports" for c in clips) or _share_matches(_SPORTS, titles):
        return "sports"
    if _share_matches(_POLITICS, titles):       # not is_us_domestic: an alligator in Florida is US news, not politics
        return "politics"
    return "other"


SIDES = ("left", "center", "right")


def swipe_order(kept: list[int], clips: list[dict], X: np.ndarray, head: int, topic: str) -> list[int]:
    """Left, Center, Right, Left, Center, Right... so every three swipes show all three sides, then the clips off that
    scale. Inside a side, the headline least like the story's headline and that side's earlier ones comes first, so
    each swipe adds an angle. Sport has no sides: one run, same rule."""
    def varied(idx: list[int]) -> list[int]:
        out, seen, rest = [], [head], sorted(idx, key=lambda i: -_ts(clips[i]["published"]))     # ties: newest first
        while rest:
            j = min(rest, key=lambda i: max(float(X[i] @ X[k]) for k in seen))
            out.append(j); seen.append(j); rest.remove(j)
        return out

    if topic == "sports":
        return varied(kept)
    by_col = {col: varied([i for i in kept if clips[i]["column"] == col]) for col in config.COLUMNS}
    rounds = [i for r in range(max(len(by_col[c]) for c in SIDES)) for c in SIDES if r < len(by_col[c]) for i in [by_col[c][r]]]
    return rounds + [i for col in config.COLUMNS if col not in SIDES for i in by_col[col]]


def build_stories(clips: list[dict], groups: list[list[int]], X: np.ndarray, now: datetime, capped: bool = True) -> list[dict]:
    judge = headline_judge(clips)
    out = []
    for members in groups:
        ms = [clips[i] for i in members]
        # cap clips per outlet, keeping the newest: a 20-clip story had eight outlets twice each
        per_outlet: dict[str, list[int]] = {}
        seen_titles = set()
        for i in sorted(members, key=lambda i: clips[i]["published"], reverse=True):
            repost = (clips[i]["channel"], clip_text(clips[i]).casefold())   # outlets re-upload the same clip
            if repost not in seen_titles:
                seen_titles.add(repost)
                per_outlet.setdefault(clips[i]["channel"], []).append(i)
        kept = [i for lst in per_outlet.values() for i in lst[:config.MAX_CLIPS_PER_OUTLET]]

        centroid = X[members].sum(axis=0)
        centroid = centroid / (np.linalg.norm(centroid) or 1)
        # a calm, plain title first, then one from a Center outlet, then the one closest to the story as a whole
        head = max(kept, key=lambda i: (-judge(clips[i]), clips[i]["column"] == "center", float(X[i] @ centroid)))

        cov = {r: set() for r in config.REGIONS}
        for c in ms:
            cov[c["region"]].add(c["channel"])
        coverage = {k: len(v) for k, v in cov.items()}
        n_outlets = sum(coverage.values())
        n_regions = sum(1 for v in coverage.values() if v)

        by_col = {k: set() for k in config.COLUMNS}
        for c in ms:
            by_col[c["column"]].add(c["channel"])
        sides = {k: len(v) for k, v in by_col.items()}
        n_sides = sum(1 for k in ("left", "center", "right") if sides[k])

        topic = topic_of(ms)
        blindspot = None
        if n_outlets >= config.BLINDSPOT_MIN_CLIPS and topic != "sports":      # left and right mean nothing for a transfer
            if sides["right"] == 0 and sides["left"] >= 2:
                blindspot = "right"     # the right didn't cover it
            elif sides["left"] == 0 and sides["right"] >= 2:
                blindspot = "left"

        latest = max(c["published"] for c in ms)
        age_h = (now - datetime.fromisoformat(latest.replace("Z", "+00:00"))).total_seconds() / 3600
        score = (n_outlets + 2 * n_regions + n_sides) * math.pow(0.5, age_h / config.RECENCY_HALF_LIFE_H)
        if n_regions == 1:
            score *= config.SINGLE_REGION_PENALTY
        if n_outlets == 1:
            score *= 0.3
        if n_sides == 1 and topic != "sports":
            score *= config.ONE_SIDE_PENALTY

        ordered = swipe_order(kept, clips, X, head, topic)
        first = min(ms, key=lambda c: c["published"])
        since = {}      # each outlet's first clip in the story: the feed keeps its newest, Compare shows who was first
        for c in ms:
            since[c["channel"]] = min(since.get(c["channel"], c["published"]), c["published"])
        out.append({
            "id": "s_" + first["id"],
            "headline": headline(clips[head]),
            "first": first["published"],      # when the story began: "new" means later than your last visit
            "updated": latest,
            "coverage": coverage,
            "sides": sides,
            "blindspot": blindspot,
            "single": n_outlets == 1,
            "score": round(score, 4),
            "topic": topic,
            "tags": tags_of(ms, topic),
            "us_domestic": topic != "sports" and is_us_domestic([c["title"] for c in ms]),
            "clips": [{**{k: clips[i][k] for k in ("id", "channel", "country", "region", "lean", "column", "published", "duration")},
                       "title": clip_text(clips[i]), "note": clips[i].get("note", ""), "since": since[clips[i]["channel"]]} for i in ordered],
        })
    out.sort(key=lambda s: s["score"], reverse=True)
    out = space_out_us(out)
    return cap_feed(out) if capped else out


def cap_feed(stories: list[dict]) -> list[dict]:
    sports = [s for s in stories if s["topic"] == "sports"][:config.MAX_SPORTS_STORIES]
    news = [s for s in stories if s["topic"] != "sports"][:config.MAX_STORIES_IN_FEED]
    keep = {id(s) for s in sports + news}
    return [s for s in stories if id(s) in keep]


def space_out_us(stories: list[dict]) -> list[dict]:
    world = [s for s in stories if not s["us_domestic"]]
    us = [s for s in stories if s["us_domestic"]]
    out = []
    while world or us:
        us_turn = (len(out) + 1) % config.US_DOMESTIC_EVERY == 0
        out.append((us if us and (us_turn or not world) else world).pop(0))
    return out


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
