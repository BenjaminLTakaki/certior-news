"""All tunable settings in one place. Change numbers here, not in the code."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANNELS_FILE = ROOT / "channels.json"
DATA_DIR = ROOT / "data"
CLIPS_FILE = DATA_DIR / "clips.json"            # rolling window of accepted clips
REJECTED_FILE = DATA_DIR / "rejected.json"      # IDs we looked at and dropped (so we don't pay to look again)
CHANNEL_CACHE_FILE = DATA_DIR / "channel_ids.json"  # handle -> channel ID + uploads playlist
FEED_FILE = ROOT / "docs" / "feed.json"         # what the app reads
SEARCH_FILE = ROOT / "docs" / "search.json"     # every story in the window, fetched the first time someone searches

# --- Fetching -------------------------------------------------------------
UPLOADS_PER_CHANNEL = 25        # newest uploads checked per channel per run (1 quota unit each call)

# --- Filtering ------------------------------------------------------------
MAX_DURATION_S = 300            # outlets often post the same event at 3-5 minutes, so a 3 minute limit lost comparisons
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
EMBED_MODEL = "BAAI/bge-base-en-v1.5"   # fastembed (ONNX, CPU); falls back to TF-IDF if unavailable
# Lowest title similarity two clips in one story may have. Tune with `python -m pipeline.tune`.
THRESHOLDS = {
    "bge-base": 0.73,       # on tests/fixtures/real_pairs.json: `python -m pipeline.tune pairs`
    "tfidf": 0.06,          # tuned on tests/fixtures/sample_clips.json
}
STORY_GAP_HOURS = 36            # a clip can only join a story that had a clip within this many hours
# Second pass: join stories the first pass split ("Ronaldo retires..." and "'Portugal will always be a part of me': Ronaldo
# retires..."). Tune with `python -m pipeline.tune merges`.
MERGE_SIMILARITY = {            # lowest similarity of two stories' average title embeddings
    "bge-base": 0.65,
    "tfidf": 0.2,
}
MERGE_FLOOR = {                 # lowest similarity of any clip in one story to any clip in the other: stops a chain of stories
    "bge-base": 0.4,            # that each look like the next from merging two ends that don't. Costs no merges on the real window.
    "tfidf": 0.0,
}
MERGE_MIN_WORDS = 0.1           # lowest TF-IDF similarity of two stories' titles + descriptions
MERGE_MIN_WORDS_SMALL = 0.25    # ...when both stories have fewer than MERGE_SMALL_STORY clips: one or two clips are too little
MERGE_SMALL_STORY = 3           # text to trust ("Roy Cooper" and "Brett Cooper", Santiago Peña and Santiago de Chile)
MERGE_COMMON_SHARE = 0.05       # words in more than this share of stories ("midterms", "Trump") don't count as shared
MIN_SHARED_KEYWORDS = 1         # distinctive words (title + description) two clips must share to be in one story
MAX_CLIPS_PER_OUTLET = 1        # per story, the newest: swiping sideways always shows another outlet
MAX_STORIES_IN_FEED = 80
RECENCY_HALF_LIFE_H = 12        # ranking: a story's score halves every N hours

# Story headlines: no kicker, no series label ("US Midterm Elections:") and no shouting when a calmer title exists.
HEADLINE_KICKERS = r"^\s*(breaking( news)?|watch|see it|just in|exclusive)\s*[:|]\s*"     # also cut from the headline
SERIES_LABEL_MIN = 3            # a "Label:" prefix one outlet opens at least this many titles with is a series label

# Summary: one sentence from the outlets' own descriptions (no AI service: free, and nothing made up)
SUMMARY_MIN = 0.2               # lowest TF-IDF similarity of that sentence to the story's titles

# Recap: each day's biggest stories, kept for a week in data/digest.json and sent in feed.json
DIGEST_FILE = DATA_DIR / "digest.json"
DIGEST_DAYS = 7
DIGEST_PER_DAY = 10

# Framing words (pipeline/framing.py): words one side uses more for the same stories, over the Recap week
FRAMING_FILE = DATA_DIR / "framing.json"
FRAMING_PRIOR = 500             # Dirichlet prior size: bigger shrinks rare words harder
FRAMING_MIN_Z = 3.0             # ~1,000 words are tested, so 1.96 would pass dozens by chance alone
FRAMING_MIN_OUTLETS = 3         # outlets on that side that used the word
FRAMING_TOP = 10

BLINDSPOT_MIN_CLIPS = 3         # a story needs at least this many outlets to get a blindspot label

LEAN_TO_COLUMN = {
    "left": "left", "lean-left": "left",
    "center": "center",
    "lean-right": "right", "right": "right",
    "unrated": "unrated",
}
COLUMNS = ["left", "center", "right", "unrated"]    # swipe order

MAX_SPORTS_STORIES = 30         # on top of MAX_STORIES_IN_FEED, so the Sports tab survives a heavy news day

# A story's topic: a third of its clip titles match, sports checked first. Anything else only appears under All.
# ponytail: keyword lists, they miss politicians and places they don't name. tests/fixtures/topic_labels.json holds the check.
SPORTS_WORDS = (r"\b(football(er|ers)?|soccer|cricket(er|ers)?|tennis|rugby|raga|hockey|basketball|baseball|nba|wnba|nfl|mlb|nhl|fifa|uefa|ucl|"
                r"olympics?|olympian|paralympics?|para athletes?|athletes?|tournament|world cup|premier league|champions league|la liga|"
                r"grand prix|formula (1|one)|f1|golf|boxing|mma|ufc|wushu|equestrian|padel|marathon|red cards?|track and field|women's sports|"
                r"kombe|mbio|anglers?|manu|manchester (united|city)|arsenal|liverpool|chelsea|real madrid|ronaldo|messi|route du rhum)\b")
POLITICS_WORDS = (r"\b(elect(ion|ions|ed|oral)|vot(e|es|er|ers|ing)|ballot|polls?|president\w*|prime minister|pm|minister\w*|ministry|parliament\w*|"
                  r"senat\w+|congress\w*|governor\w*|gubernatorial|mayor|government\w*|lawmakers?|democrat\w*|republicans?|gop|trump|vance|biden|"
                  r"netanyahu|putin|zelensky|macron|modi|schumer|jeffries|impeach\w*|hegseth|pentagon|white house|wars?|military|army|troops|navy|"
                  r"airstrikes?|missiles?|drones?|bombing|shelling|invasion|ceasefire|idf|hamas|hezbollah|houthis?|taliban|nato|sanctions?|diplomat\w*|"
                  r"embassy|treaty|summit|protest\w*|rall(y|ies) (against|in|for|over)|mass rallies|coup|opposition|party|parties|coalition|manifesto|"
                  r"campaign|activists?|national security|policy|fighting|conflict|workers? strike|politics|political|politicians?|nationwide strike|alliance|too close to call|amendments?|anc|apc|upinzani|uchaguzi|siasa|israeli?|palestin\w+|gaza|west bank|lebanon|"
                  r"ukrain\w+|russian?|iran\w*|kashmir|south china sea|lge 2026|midterms?|human rights|settlers?|migrants?)\b")

# More tags. A story gets every tag a third of its titles match, so one story can sit under several tabs.
# ponytail: keyword lists again, tests/test_pipeline.py holds their known traps.
TAG_WORDS = {
    "business": (r"\b(econom(y|ic|ics|ist|ists)|inflation|interest rates?|central bank|(?<!west )(?<!blood )banks?|banking|depositors?|rate (rise|hike|cut)s?|stocks?|shares|stock markets?|global markets?|wall street|dow|nasdaq|"
                 r"investors?|investment|investing|trade (deal|war|costs?|cards?)|tariffs?|exports?|imports?|gdp|debt|budget|taxe?s?|recession|"
                 r"billion|oil prices?|companies|company|ceo|startup|layoffs?|jobs? row|wages?|prices?|cost of living|retail)\b"),
    "tech": (r"\b(ai|a\.i\.|artificial intelligence|chatgpt|openai|anthropic|chips?|semiconductors?|nvidia|apple|google|microsoft|meta|amazon|tesla|"
             r"robots?|robotics|software|hackers?|cyberattacks?|cyber attack|malware|crypto|bitcoin|data cent(er|re)s?|social media|smartphone|"
             r"technology|tech)\b"),
    "science": (r"\b(nasa|spacex?|space x|satellite|meteorite|astronauts?|scientists?|researchers?|science|scientific|study finds|species|wildlife|fossil|dinosaur|telescope|planet|moon|asteroid|health|doctors?|nurses?|patients?|cancer|vaccines?|disease|virus|outbreak|pandemic|surgery|colonoscop\w+|medical|medicine|mental health|healthcare|heart (disease|attack|health)|nhs|lung|obesity|dementia|malaria|cholera|climate|cop\d\d|emissions?|carbon|pollution|smog|air quality|renewable|solar|wind (farm|power|turbines?)|energy transition|global warming|heatwave|drought|wildfires?|coral|deforestation|environment\w*)\b"),
    "crime": (r"\b(murder\w*|killers?|killing|convicted|guilty|jurors?|trial|sentenced|jailed|jail|prison|arrested|arrests?|rape|assault|"
              r"robbery|theft|stolen|fraud|shooting|bomb threats?|gunman|stabb\w+|smuggl\w+|seized|bodycam|prosecut\w+|investigat\w+|detained)\b"),
    "disasters": (r"\b(earthquake|tsunami|floods?|flooding|flooded|drenched|tornado|hurricane|cyclone|typhoon|storm|landslide|sinkhole|volcano|"
                  r"crash(es)?|(building|bridge|mine) collapse|collision|collide|derail\w*|explosion|blast|rubble|rescuers?|helicopters?"
                  r")\b"),
    "culture": (r"\b(film|films|movie|movies|box office|hollywood|bollywood|actor|actress|singer|album|concert|music|musician|theatre|theater|festival|"
                r"oscars?|grammys?|celebrit\w+|royal family|memes?|netflix|video games?|gaming|nintendo|zelda|museum|art|fashion|book|author)\b"),
}

REGIONS = ["mideast_africa", "americas", "asia", "europe"]
ONE_SIDE_PENALTY = 0.5          # ranking: stories you can compare across left, center and right come first
SINGLE_REGION_PENALTY = 0.4     # ranking: stories only one region covers sink, which keeps domestic news from dominating
US_DOMESTIC_EVERY = 4           # feed order: at most one US domestic story in every N. Every region covers US politics, so scores alone can't hold it back
US_DOMESTIC_SHARE = 1 / 3       # a story counts as US domestic when this share of its clip titles match below
# ponytail: keyword list on titles, misses US stories that name none of these. Swap for a classifier if it misjudges too many.
# Bare senate/congress/governor are left out because they also mean Nigerian governors and India's Congress party.
US_DOMESTIC = (r"\b(midterms?|republicans?|democrats?|gop|white house|pentagon|impeach\w*|vance|in america|(?<!latin )americans?|u\.?s\.? (senate|congress|house)|"
               r"alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|"
               r"kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|"
               r"new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|"
               r"south carolina|south dakota|tennessee|texas|utah|vermont|virginia|wisconsin|wyoming)\b")
