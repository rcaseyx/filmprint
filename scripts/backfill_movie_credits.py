"""
Backfill movie_credits from movies.raw_tmdb for movies fetched before the
movie_credits table existed. Run once; going forward, upsert_movie /
batch_upsert_movies keep movie_credits in sync automatically.
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, get_connection, _upsert_movie_credits
import json


def backfill():
    init_db()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, raw_tmdb FROM movies WHERE raw_tmdb IS NOT NULL")
        rows = cur.fetchall()
        print(f"Backfilling movie_credits for {len(rows)} movies...")
        for i, row in enumerate(rows):
            tmdb_data = json.loads(row["raw_tmdb"]) if isinstance(row["raw_tmdb"], str) else row["raw_tmdb"]
            if not tmdb_data.get("credits"):
                continue
            _upsert_movie_credits(cur, row["id"], tmdb_data)
            if (i + 1) % 500 == 0:
                print(f"  {i + 1}/{len(rows)}")
        print("Done.")


if __name__ == "__main__":
    backfill()
