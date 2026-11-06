"""Tune the grouping thresholds against clips you labelled by hand.

1. Export the current window (after a few real runs):
       python -m pipeline.tune export
   -> data/labels.csv. Open it in Excel/Sheets. The `story` column is pre-filled with the
      pipeline's guess; fix it so clips about the same event share the same label.
2. Evaluate:
       python -m pipeline.tune evaluate
   -> tries many thresholds and prints the best ones. Copy the winner into
      THRESHOLDS in pipeline/config.py.

`--fixture tests/fixtures/sample_clips.json` evaluates against the built-in sample instead.

`python -m pipeline.tune pairs` scores the embedding alone on tests/fixtures/real_pairs.json: 200 real clip
pairs, sampled to be hard (most sit near the threshold), each marked same event or not by Claude, not an
independent reviewer. The distinctive-word check needs descriptions, so it is not applied here.

`python -m pipeline.tune merges` scores the second pass (stories the first pass split) on
tests/fixtures/real_window.json.gz: every clip of one real 48 h window, with the events it split and
stories that must stay on their own labelled by Claude. Prints stories before/after, how many pieces each
event ends up in, and every wrong merge, for the configured settings and a few around them.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import itertools
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import config
from .grouping import build_stories, embed, group
from .run import apply_channels, load_json, load_mock

LABELS = config.DATA_DIR / "labels.csv"


def pair_scores(true: list[str], groups: list[list[int]]) -> dict:
    pred = {}
    for g, members in enumerate(groups):
        for i in members:
            pred[i] = g
    tp = fp = fn = 0
    for i, j in itertools.combinations(range(len(true)), 2):
        same_t, same_p = true[i] == true[j], pred[i] == pred[j]
        tp += same_t and same_p
        fp += (not same_t) and same_p
        fn += same_t and (not same_p)
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    return {"precision": precision, "recall": recall, "wrong_merges": fp, "missed": fn}


def export():
    store = load_json(config.CLIPS_FILE, {})
    clips = sorted(store.values(), key=lambda c: c["published"])
    _, groups, _ = group(clips)
    label = {}
    for g, members in enumerate(groups):
        for i in members:
            label[clips[i]["id"]] = f"s{g:03d}"
    with LABELS.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "published", "channel", "title", "story"])
        for c in clips:
            w.writerow([c["id"], c["published"], c["channel"], c["title"], label[c["id"]]])
    print(f"Wrote {len(clips)} clips to {LABELS}. Fix the `story` column, then run: python -m pipeline.tune evaluate")


def evaluate(fixture: Path | None):
    if fixture:
        now = datetime.now(timezone.utc)
        clips = sorted(load_mock(fixture, now).values(), key=lambda c: c["published"])
        true = [c["story"] for c in clips]
    else:
        store = load_json(config.CLIPS_FILE, {})
        rows = {r["id"]: r["story"] for r in csv.DictReader(LABELS.open(encoding="utf-8"))}
        clips = sorted((c for c in store.values() if c["id"] in rows), key=lambda c: c["published"])
        true = [rows[c["id"]] for c in clips]
    name, X = embed(clips)
    print(f"embedder={name}  clips={len(clips)}  true stories={len(set(true))}")
    base = config.THRESHOLDS[name]
    results = []
    for th in np.arange(max(0.025, base - 0.15), base + 0.151, 0.025):
        s = pair_scores(true, group(clips, float(th), (name, X))[1])
        results.append((round(float(th), 3), s))
    # a wrong merge (unrelated clip when swiping sideways) is worse than a missed one:
    # keep settings with precision >= 0.97, then take the best recall
    good = [r for r in results if r[1]["precision"] >= 0.97] or results
    good.sort(key=lambda r: (r[1]["recall"], r[1]["precision"]), reverse=True)
    print(f"{'thresh':>6} {'precision':>9} {'recall':>7} {'wrong merges':>12} {'missed':>7}")
    for th, s in good[:8]:
        print(f"{th:6.3f} {s['precision']:9.3f} {s['recall']:7.3f} {s['wrong_merges']:12d} {s['missed']:7d}")
    cur = pair_scores(true, group(clips, base, (name, X))[1])
    print(f"\ncurrent config ({base}): precision={cur['precision']:.3f} recall={cur['recall']:.3f}")
    print(f'suggested: THRESHOLDS["{name}"] = {good[0][0]}')


def pairs():
    rows = json.loads((Path(__file__).parent.parent / "tests" / "fixtures" / "real_pairs.json").read_text(encoding="utf-8"))
    titles = sorted({r["ta"] for r in rows} | {r["tb"] for r in rows})
    name, X = embed([{"title": t, "channel": ""} for t in titles])
    at = {t: i for i, t in enumerate(titles)}
    sim = np.array([float(X[at[r["ta"]]] @ X[at[r["tb"]]]) for r in rows])
    same = np.array([r["same"] for r in rows])
    print(f"embedder={name} pairs={len(rows)} same={same.sum()} (configured threshold {config.THRESHOLDS[name]})")
    print(f"{'thresh':>6} {'precision':>9} {'recall':>7}")
    for th in np.arange(config.THRESHOLDS[name] - 0.06, config.THRESHOLDS[name] + 0.061, 0.01):
        hit = sim >= th
        print(f"{th:6.2f} {(hit & same).sum() / max(1, hit.sum()):9.3f} {(hit & same).sum() / same.sum():7.3f}")


REAL_WINDOW = Path(__file__).parent.parent / "tests" / "fixtures" / "real_window.json.gz"


def load_real_window() -> tuple[list[dict], datetime]:
    now = datetime(2026, 11, 6, 1, 20, tzinfo=timezone.utc)       # when the window was frozen
    rows = json.loads(gzip.open(REAL_WINDOW, "rt", encoding="utf-8").read())["clips"]
    store = {r["id"]: {**r, "published": (now - timedelta(minutes=r["minutes_ago"])).strftime("%Y-%m-%dT%H:%M:%SZ")} for r in rows}
    store = apply_channels(store, load_json(config.CHANNELS_FILE, {})["channels"])
    for r in rows:      # an outlet removed from channels.json since still counts for the grouping
        store.setdefault(r["id"], {**r, "published": (now - timedelta(minutes=r["minutes_ago"])).strftime("%Y-%m-%dT%H:%M:%SZ")})
    return sorted(store.values(), key=lambda c: c["published"]), now


def merge_scores(clips: list[dict], groups: list[list[int]]) -> dict:
    """pieces: how many stories each labelled event is in. wrong: pairs of labels that ended up in one story."""
    story = {i: n for n, g in enumerate(groups) for i in g}
    found: dict[str, set] = {}
    for i, c in enumerate(clips):
        if c.get("story"):
            found.setdefault(c["story"], set()).add(story[i])
    pieces = {k: len(v) for k, v in found.items() if not k.startswith("trap")}
    wrong = [(a, b) for a, b in itertools.combinations(sorted(found), 2) if found[a] & found[b]]
    return {"pieces": pieces, "wrong": wrong}


def merges():
    clips, now = load_real_window()
    name, X = embed(clips)
    print(f"embedder={name} clips={len(clips)} (tests/fixtures/real_window.json.gz)")
    first = group(clips, embedded=(name, X), merge=False)[1]
    base = merge_scores(clips, first)

    def feed_dupes(groups):     # stories in the capped feed that repeat a labelled event already in it
        seen, n = set(), 0
        for s in build_stories(clips, groups, X, now):
            labels = {c.get("story") for c in clips if c["id"] in {k["id"] for k in s["clips"]}} - {None}
            n += any(l in seen for l in labels if not l.startswith("trap"))
            seen |= labels
        return n

    print(f"{'setting':34} {'stories':>7} {'merges':>6} {'event pieces':>12} {'repeats in feed':>15} {'wrong merges':>12}")
    print(f"{'first pass only':34} {len(first):7d} {'-':>6} {sum(base['pieces'].values()):12d} {feed_dupes(first):15d} {len(base['wrong']):12d}")
    saved = (dict(config.MERGE_SIMILARITY), config.MERGE_MIN_WORDS)
    current = None
    for sim in (saved[0][name] - 0.05, saved[0][name], saved[0][name] + 0.05):
        for words in (saved[1] - 0.02, saved[1], saved[1] + 0.05):
            config.MERGE_SIMILARITY[name], config.MERGE_MIN_WORDS = round(sim, 3), round(words, 3)
            groups = group(clips, embedded=(name, X))[1]
            s = merge_scores(clips, groups)
            is_current = (sim, words) == (saved[0][name], saved[1])
            current = (s, groups) if is_current else current
            label = f"similarity {sim:.2f}, words {words:.2f}" + ("  <- config" if is_current else "")
            print(f"{label:34} {len(groups):7d} {len(first) - len(groups):6d} {sum(s['pieces'].values()):12d} {feed_dupes(groups):15d} {len(s['wrong']):12d}")
    config.MERGE_SIMILARITY.update(saved[0])
    config.MERGE_MIN_WORDS = saved[1]
    s = current[0]
    print("\nevent pieces, first pass -> config:")
    for k in sorted(base["pieces"]):
        print(f"  {k:16} {base['pieces'][k]:2d} -> {s['pieces'][k]}")
    print("wrong merges with the config:" if s["wrong"] else "no wrong merges with the config")
    title = {c["story"]: c["title"] for c in clips if c.get("story")}
    for a, b in s["wrong"]:
        print(f"  {title[a][:70]}\n    + {title[b][:70]}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["export", "evaluate", "pairs", "merges"])
    ap.add_argument("--fixture", type=Path)
    a = ap.parse_args(argv)
    {"export": export, "pairs": pairs, "merges": merges}.get(a.cmd, lambda: evaluate(a.fixture))()


if __name__ == "__main__":
    main()
