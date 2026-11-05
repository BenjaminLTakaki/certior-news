"""All tunable settings in one place. Change numbers here, not in the code."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANNELS_FILE = ROOT / "channels.json"
DATA_DIR = ROOT / "data"
CLIPS_FILE = DATA_DIR / "clips.json"            # rolling window of accepted clips
REJECTED_FILE = DATA_DIR / "rejected.json"      # IDs we looked at and dropped (so we don't pay to look again)
CHANNEL_CACHE_FILE = DATA_DIR / "channel_ids.json"  # handle -> channel ID + uploads playlist
FEED_FILE = ROOT / "docs" / "feed.json"         # what the app reads

# --- Fetching -------------------------------------------------------------
UPLOADS_PER_CHANNEL = 25        # newest uploads checked per channel per run (1 quota unit each call)

# --- Filtering ------------------------------------------------------------
MAX_DURATION_S = 180            # YouTube Shorts can be up to 3 minutes
MIN_DURATION_S = 8
MAX_AGE_HOURS = 48              # clips older than this never enter the feed
WINDOW_HOURS = 72               # how long clips are kept in data/clips.json
BLOCKLIST = [                   # case-insensitive regexes matched against the title
    r"\bfull (episode|interview|show|segment)\b",
    r"\blive ?stream\b",
    r"^\s*live\s*[:|]",
    r"\bwatch live\b",
    r"\btrailer\b",
    r"\bpromo\b",
    r"\bcoming up\b",
    r"\btonight on\b",
    r"\bpodcast\b",
    r"\bsubscribe\b",
    r"\bsponsored\b",
    r"#ad\b",
]

# --- Grouping -------------------------------------------------------------
EMBED_MODEL = "BAAI/bge-small-en-v1.5"   # fastembed (ONNX, CPU); falls back to TF-IDF if unavailable
# Thresholds per embedder. Start here, then tune with `python -m pipeline.tune`.
THRESHOLDS = {
    "bge-small": {"join": 0.76, "merge": 0.84},   # untested starting point: tune after a few days
    "tfidf":     {"join": 0.15, "merge": 0.25},   # tuned on tests/fixtures/sample_clips.json
}
STORY_GAP_HOURS = 36            # a clip can only join a story that had a clip within this many hours
MIN_SHARED_KEYWORDS = 1         # distinctive words a clip must share with a story to join it
MAX_CLIPS_PER_OUTLET = 2        # per story
MAX_STORIES_IN_FEED = 80
RECENCY_HALF_LIFE_H = 12        # ranking: a story's score halves every N hours

# Swipe order. Alphabetical by label, so no region always comes first.
REGIONS = ["mideast_africa", "americas", "asia", "europe"]
SINGLE_REGION_PENALTY = 0.4     # ranking: stories only one region covers sink, which keeps domestic news from dominating
