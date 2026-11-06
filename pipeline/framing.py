"""Framing words: which words Left outlets use more than Right ones, and the reverse, for the SAME stories.

Only stories both sides covered count, so a side covering different events (selection) doesn't pass for wording
(framing). Each outlet counts once per story, so one prolific channel can't make a word look like its side's. The
test is the weighted log-odds ratio with an informative Dirichlet prior (Monroe, Colaresi & Quinn 2008, "Fightin'
Words"): the prior shrinks rare words, and z-scores say how far a difference is from chance.

On one real 48 h window no word got past z = 1.8, so the state keeps a week, and the app says so when nothing passes.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from . import config
from .grouping import clip_text, tokens


def observe(state: dict, clips: list[dict], groups: list[list[int]]) -> dict:
    """state: {outlet's first clip id in a story: {day, side, channel, story, words}}. Entries for clips in this window
    are rebuilt from the current grouping (stories change while clips are new); older ones stay as they were."""
    in_window = {c["id"] for c in clips}
    state = {k: v for k, v in state.items() if k not in in_window}
    for g in groups:
        ms = [clips[i] for i in g]
        if not {"left", "right"} <= {c["column"] for c in ms}:
            continue
        story = min(ms, key=lambda c: c["published"])["id"]
        for ch in {c["channel"] for c in ms if c["column"] in ("left", "right")}:
            mine = sorted((c for c in ms if c["channel"] == ch), key=lambda c: c["published"])
            state[mine[0]["id"]] = {"day": mine[0]["published"][:10], "side": mine[0]["column"], "channel": ch,
                                    "story": story, "words": sorted({w for c in mine for w in tokens(clip_text(c))})}
    return state


def prune(state: dict, now: datetime) -> dict:
    since = (now - timedelta(days=config.DIGEST_DAYS - 1)).strftime("%Y-%m-%d")
    return {k: v for k, v in state.items() if v["day"] >= since}


def top_words(state: dict) -> dict:
    count = {"left": Counter(), "right": Counter()}
    outlets = {"left": defaultdict(set), "right": defaultdict(set)}
    for e in state.values():
        for w in e["words"]:
            count[e["side"]][w] += 1
            outlets[e["side"]][w].add(e["channel"])
    prior = count["left"] + count["right"]
    total = sum(prior.values())
    n = {side: sum(c.values()) for side, c in count.items()}
    out = {"left": [], "right": [], "headlines": len(state), "stories": len({e["story"] for e in state.values()})}
    if not total:
        return out
    a0 = config.FRAMING_PRIOR
    for w in prior:
        a = a0 * prior[w] / total
        yl, yr = count["left"][w], count["right"][w]
        delta = (math.log((yl + a) / (n["left"] + a0 - yl - a)) - math.log((yr + a) / (n["right"] + a0 - yr - a)))
        z = delta / math.sqrt(1 / (yl + a) + 1 / (yr + a))
        side = "left" if z > 0 else "right"
        if abs(z) >= config.FRAMING_MIN_Z and len(outlets[side][w]) >= config.FRAMING_MIN_OUTLETS:
            out[side].append({"word": w, "z": round(abs(z), 1), "outlets": len(outlets[side][w])})
    for side in ("left", "right"):
        out[side] = sorted(out[side], key=lambda x: -x["z"])[:config.FRAMING_TOP]
    return out
