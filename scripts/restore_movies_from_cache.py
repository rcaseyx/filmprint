"""
One-off recovery script: restore `movies` (and `movie_credits`, populated
inline by batch_upsert_movies) from the local TMDB response cache at
data/cache/movie_*.json.

Written after the 2026-07-14 incident where a destructive test fixture ran
TRUNCATE ... CASCADE against production, wiping the movies table. Every movie
ever fetched via filmprint.tmdb.get_movie_details() is cached locally as a raw
TMDB response -- including keywords + credits, since get_movie_details always
requests append_to_response=keywords,credits. _cached_get() only writes a cache
file after response.raise_for_status() succeeds, so every file here is a real,
valid movie record. Restoring from these costs zero TMDB API calls -- just
local file reads plus DB writes. See
/Users/rcaseyx/projects/filmprint-data-recovery-plan.md, Phase 1.

Idempotent -- batch_upsert_movies upserts on conflict, safe to re-run.

Usage:
    python scripts/restore_movies_from_cache.py [--chunk-size 50]
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, batch_upsert_movies, close_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunk-size", type=int, default=50)
    args = parser.parse_args()

    init_db()

    cache_files = sorted(CACHE_DIR.glob("movie_*.json"))
    log.info("Found %d cached movie detail files", len(cache_files))

    chunk: list[dict] = []
    restored = 0
    skipped = 0
    for path in cache_files:
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            log.warning("Skipping unparseable cache file: %s", path.name)
            skipped += 1
            continue
        if not data.get("id"):
            log.warning("Skipping cache file with no id: %s", path.name)
            skipped += 1
            continue
        chunk.append(data)
        if len(chunk) >= args.chunk_size:
            batch_upsert_movies(chunk)
            restored += len(chunk)
            chunk = []
            if restored % 1000 < args.chunk_size:
                log.info("Restored %d/%d movies", restored, len(cache_files))

    if chunk:
        batch_upsert_movies(chunk)
        restored += len(chunk)

    log.info("Done. Restored %d movies (%d skipped) from local cache.", restored, skipped)
    close_db()


if __name__ == "__main__":
    main()
