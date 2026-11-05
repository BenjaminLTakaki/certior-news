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
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import config
from .grouping import embed, group
from .run import load_json, load_mock

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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["export", "evaluate"])
    ap.add_argument("--fixture", type=Path)
    a = ap.parse_args(argv)
    export() if a.cmd == "export" else evaluate(a.fixture)


if __name__ == "__main__":
    main()
