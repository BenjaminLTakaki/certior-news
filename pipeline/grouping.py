"""Group clips about the same event into stories.

A clip joins a story only if BOTH:
  1. its embedding is close to the story's average embedding (cosine >= join threshold), and
  2. it shares at least one *distinctive* word with the story (a word that is not common
     across the whole window), which stops "two different shootings" from merging.
Afterwards, stories that are very close are merged.
"""
from __future__ import annotations

import math
import os
import re
import sys
from collections import Counter
from datetime import datetime

import numpy as np

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


def clip_text(c: dict) -> str:
    return f"{c['title']}. {c.get('desc', '')}".strip()


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


def embed(texts: list[str]) -> tuple[str, np.ndarray]:
    """Returns (embedder name, L2-normalised matrix). Uses bge-small via fastembed when it can,
    TF-IDF otherwise (e.g. no internet for the model download). EMBEDDER=tfidf forces the fallback."""
    if os.environ.get("EMBEDDER", "").lower() != "tfidf":
        try:
            from fastembed import TextEmbedding
            model = TextEmbedding(model_name=config.EMBED_MODEL,
                                  cache_dir=os.environ.get("FASTEMBED_CACHE_PATH"))
            m = np.array(list(model.embed(texts)), dtype=np.float32)
            return "bge-small", _normalize(m)
        except Exception as e:  # noqa: BLE001 - any failure -> fallback, never break the feed
            print(f"[grouping] fastembed unavailable ({type(e).__name__}: {e}); using TF-IDF", file=sys.stderr)
    return "tfidf", _tfidf(texts)


# --------------------------------------------------------------------------- grouping
def _hours(a: str, b: str) -> float:
    ta = datetime.fromisoformat(a.replace("Z", "+00:00"))
    tb = datetime.fromisoformat(b.replace("Z", "+00:00"))
    return abs((ta - tb).total_seconds()) / 3600


def group(clips: list[dict], thresholds: dict | None = None,
          embedded: tuple[str, np.ndarray] | None = None) -> tuple[str, list[list[int]], np.ndarray]:
    """Returns (embedder name, list of stories as lists of clip indexes, embedding matrix).
    `clips` must be sorted oldest -> newest. Pass `embedded` to reuse embeddings (tuning)."""
    if not clips:
        return "none", [], np.zeros((0, 1))
    name, X = embedded or embed([clip_text(c) for c in clips])
    th = thresholds or config.THRESHOLDS[name]

    # distinctive words: appear in at most 15% of clips in the window (and at least in the clip itself)
    docs = [set(tokens(clip_text(c))) for c in clips]
    df = Counter(w for d in docs for w in d)
    cap = max(3, int(0.15 * len(clips)))
    kw = [{w for w in d if df[w] <= cap} for d in docs]

    stories: list[dict] = []   # {members, sum, words: Counter, last}
    for i, c in enumerate(clips):
        best, best_sim = None, -1.0
        for s in stories:
            if _hours(c["published"], s["last"]) > config.STORY_GAP_HOURS:
                continue
            centroid = s["sum"] / (np.linalg.norm(s["sum"]) or 1)
            sim = float(centroid @ X[i])
            if sim < th["join"] or sim <= best_sim:
                continue
            if len(kw[i] & s["words"].keys()) < config.MIN_SHARED_KEYWORDS:
                continue
            best, best_sim = s, sim
        if best is None:
            stories.append({"members": [i], "sum": X[i].copy(), "words": Counter(kw[i]), "last": c["published"]})
        else:
            best["members"].append(i)
            best["sum"] += X[i]
            best["words"].update(kw[i])
            best["last"] = c["published"]

    # merge pass (union-find on stories)
    parent = list(range(len(stories)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    cents = [s["sum"] / (np.linalg.norm(s["sum"]) or 1) for s in stories]
    for a in range(len(stories)):
        for b in range(a + 1, len(stories)):
            sa, sb = stories[a], stories[b]
            first_b = clips[sb["members"][0]]["published"]
            if _hours(sa["last"], first_b) > config.STORY_GAP_HOURS and _hours(sb["last"], clips[sa["members"][0]]["published"]) > config.STORY_GAP_HOURS:
                continue
            if float(cents[a] @ cents[b]) < th["merge"]:
                continue
            if len(sa["words"].keys() & sb["words"].keys()) < max(2, config.MIN_SHARED_KEYWORDS):
                continue
            parent[find(b)] = find(a)

    merged: dict[int, list[int]] = {}
    for idx, s in enumerate(stories):
        merged.setdefault(find(idx), []).extend(s["members"])
    return name, [sorted(m) for m in merged.values()], X


# --------------------------------------------------------------------------- feed building
COL_ORDER = {"left": 0, "center": 1, "right": 2}


def build_stories(clips: list[dict], groups: list[list[int]], X: np.ndarray, now: datetime) -> list[dict]:
    out = []
    for members in groups:
        ms = [clips[i] for i in members]
        # cap clips per outlet (keep newest)
        per_outlet: dict[str, list[int]] = {}
        for i in sorted(members, key=lambda i: clips[i]["published"], reverse=True):
            per_outlet.setdefault(clips[i]["channel"], []).append(i)
        kept = [i for lst in per_outlet.values() for i in lst[:config.MAX_CLIPS_PER_OUTLET]]

        centroid = X[members].sum(axis=0)
        centroid = centroid / (np.linalg.norm(centroid) or 1)
        centre_pool = [i for i in kept if clips[i]["column"] == "center"] or kept
        head = max(centre_pool, key=lambda i: float(X[i] @ centroid))

        cov = {"left": set(), "center": set(), "right": set()}
        for c in ms:
            cov[c["column"]].add(c["channel"])
        coverage = {k: len(v) for k, v in cov.items()}
        n_outlets = sum(coverage.values())
        n_cols = sum(1 for v in coverage.values() if v)

        blindspot = None
        if n_outlets >= config.BLINDSPOT_MIN_CLIPS:
            if coverage["right"] == 0 and coverage["left"] >= 2:
                blindspot = "right"     # the right didn't cover it
            elif coverage["left"] == 0 and coverage["right"] >= 2:
                blindspot = "left"

        latest = max(c["published"] for c in ms)
        age_h = (now - datetime.fromisoformat(latest.replace("Z", "+00:00"))).total_seconds() / 3600
        score = (n_outlets + 0.5 * n_cols) * math.pow(0.5, age_h / config.RECENCY_HALF_LIFE_H)
        if n_outlets == 1:
            score *= 0.3

        # Left -> Center -> Right, newest first inside each column
        ordered = sorted(kept, key=lambda i: (COL_ORDER[clips[i]["column"]], -_ts(clips[i]["published"])))
        first = min(ms, key=lambda c: c["published"])
        out.append({
            "id": "s_" + first["id"],
            "headline": clips[head]["title"],
            "updated": latest,
            "coverage": coverage,
            "blindspot": blindspot,
            "single": n_outlets == 1,
            "score": round(score, 4),
            "clips": [{k: clips[i][k] for k in ("id", "title", "channel", "lean", "column", "published", "duration")}
                      for i in ordered],
        })
    out.sort(key=lambda s: s["score"], reverse=True)
    return out[:config.MAX_STORIES_IN_FEED]


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
