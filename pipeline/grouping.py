"""Group clips about the same event into stories.

Two clips can share a story only if BOTH:
  1. their title embeddings are close (cosine >= threshold), and
  2. they share at least one *distinctive* word (a word that is not common across the whole
     window), which stops "two different shootings" from merging.
Complete-linkage clustering holds EVERY pair in a story to that bar. Comparing clips to a story's
running average instead let one big event snowball: all the midterm clips became a single story.
"""
from __future__ import annotations

import math
import os
import random
import re
import sys
from collections import Counter
from datetime import datetime

import numpy as np
from sklearn.cluster import AgglomerativeClustering

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


def clean_title(title: str, channel: str = "") -> str:
    """Drop what outlets bolt onto titles ("| DW News", "#BBCNews", "FRANCE 24 English"): it is noise to read and to compare."""
    t = title.strip()
    for _ in range(3):      # "... | AJ #shorts" needs the hashtag gone before the tail can go
        before = t
        t = _TAGS.sub("", t)
        t = re.sub(rf"[\s|:\-]*{re.escape(channel)}\s*$", "", t, flags=re.I) if channel else t
        m = _TAIL.match(t)
        t = m[1].rstrip() if m else t
        if t == before:
            break
    return t or title.strip()


def clip_text(c: dict) -> str:
    return clean_title(c["title"], c["channel"])       # descriptions are mostly about the outlet, and pulled unrelated clips together


# --------------------------------------------------------------------------- embedders
def _tfidf(texts: list[str]) -> np.ndarray:
    from sklearn.feature_extraction.text import TfidfVectorizer
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
          embedded: tuple[str, np.ndarray] | None = None) -> tuple[str, list[list[int]], np.ndarray]:
    """Returns (embedder name, list of stories as lists of clip indexes, embedding matrix).
    Pass `embedded` to reuse embeddings (tuning)."""
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
    stories: dict[int, list[int]] = {}
    for i, label in enumerate(labels):
        stories.setdefault(int(label), []).append(i)
    return name, list(stories.values()), X


# --------------------------------------------------------------------------- feed building
COL_ORDER = {c: i for i, c in enumerate(config.COLUMNS)}
_US_DOMESTIC = re.compile(config.US_DOMESTIC, re.I)


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
    return tags + [tag for tag, rx in _TAGS_RX.items() if _share_matches(rx, titles)]


def topic_of(clips: list[dict]) -> str:
    titles = [c["title"] for c in clips]
    if any(c.get("topic") == "sports" for c in clips) or _share_matches(_SPORTS, titles):
        return "sports"
    if _share_matches(_POLITICS, titles):       # not is_us_domestic: an alligator in Florida is US news, not politics
        return "politics"
    return "other"


def build_stories(clips: list[dict], groups: list[list[int]], X: np.ndarray, now: datetime, capped: bool = True) -> list[dict]:
    out = []
    for members in groups:
        ms = [clips[i] for i in members]
        # cap clips per outlet (keep newest)
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
        centre_pool = [i for i in kept if clips[i]["column"] == "center"] or kept
        head = max(centre_pool, key=lambda i: float(X[i] @ centroid))

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

        # Left -> Center -> Right -> unrated, newest first inside each
        ordered = sorted(kept, key=lambda i: (COL_ORDER[clips[i]["column"]], -_ts(clips[i]["published"])))
        first = min(ms, key=lambda c: c["published"])
        out.append({
            "id": "s_" + first["id"],
            "headline": clip_text(clips[head]),
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
                       "title": clip_text(clips[i]), "note": clips[i].get("note", "")} for i in ordered],
        })
    out.sort(key=lambda s: s["score"], reverse=True)
    out = space_out_us(out)
    return cap_feed(out) if capped else out


def _words(title: str) -> set[str]:
    return set(tokens(title))


def build_daily(stories: list[dict], date: str) -> dict:
    """The day's game: pairs of real headlines from the left and the right on the same event, the most differently worded first.
    Politics only: a tornado has no framing to spot, however each side words it."""
    candidates = []
    for s in stories:
        if s["topic"] != "politics":
            continue
        left = [c for c in s["clips"] if c["column"] == "left"]
        right = [c for c in s["clips"] if c["column"] == "right"]
        best = None
        for a in left:
            for b in right:
                wa, wb = _words(a["title"]), _words(b["title"])
                gives_away = any(set(tokens(c["channel"])) & _words(c["title"]) for c in (a, b))
                if gives_away or len(wa) < 4 or len(wb) < 4:
                    continue
                overlap = len(wa & wb) / len(wa | wb)
                if best is None or overlap < best[0]:
                    best = (overlap, a, b)
        if best and best[0] < 0.6:
            candidates.append((best[0], s["us_domestic"], best[1], best[2]))
    candidates.sort(key=lambda c: c[0])
    rounds, us, used = [], 0, []
    pick = random.Random(date)      # same game for everyone, and the answer isn't always in the same place
    for _, is_us, a, b in candidates:
        if is_us and us >= config.DAILY_MAX_US:
            continue
        words = _words(a["title"]) | _words(b["title"])
        if any(len(words & u) / len(words | u) >= 0.2 for u in used):
            continue        # grouping can split one event into two stories: don't ask about it twice
        used.append(words)
        us += is_us
        pair = [a, b]
        pick.shuffle(pair)
        rounds.append({"ask": pick.choice(["left", "right"]),
                       "clips": [{k: c[k] for k in ("id", "title", "channel", "country", "column", "note")} for c in pair]})
        if len(rounds) == config.DAILY_ROUNDS:
            break
    return {"date": date, "rounds": rounds}


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
