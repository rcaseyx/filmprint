"""
Refresh Letterboxd data from RSS and merge with local CSV seed.
Run periodically (cron or manually) to keep ratings up to date.
"""

import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.letterboxd import fetch_rss_ratings, fetch_rss_watchlist

DATA_DIR = Path(__file__).parent.parent / "data"
RATINGS_CACHE = DATA_DIR / "ratings_rss.json"
WATCHLIST_CACHE = DATA_DIR / "watchlist_rss.json"


def refresh():
    username = os.environ["LETTERBOXD_USERNAME"]

    ratings = fetch_rss_ratings(username)
    watchlist = fetch_rss_watchlist(username)

    RATINGS_CACHE.write_text(json.dumps(ratings, indent=2))
    WATCHLIST_CACHE.write_text(json.dumps(watchlist, indent=2))

    print(f"Refreshed {len(ratings)} ratings and {len(watchlist)} watchlist entries.")


if __name__ == "__main__":
    refresh()
