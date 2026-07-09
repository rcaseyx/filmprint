"""
One-time (or ad-hoc) sweep of popular movies per year from TMDB, independent
of user Letterboxd syncs, to widen `movies` coverage for well-known titles
nobody has synced yet (see GitHub issue #263).

Usage:
    python scripts/backfill_tmdb_catalog.py [--start-year 1970] [--end-year 2026] [--per-year 100]
"""

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, close_db
from filmprint.catalog import sweep_popular_movies

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-year", type=int, default=1970)
    parser.add_argument("--end-year", type=int, default=date.today().year)
    parser.add_argument("--per-year", type=int, default=100)
    parser.add_argument("--vote-count-gte", type=int, default=1000)
    args = parser.parse_args()

    log.info(
        "Starting TMDB catalog backfill: years %d-%d, up to %d/year, vote_count >= %d",
        args.start_year, args.end_year, args.per_year, args.vote_count_gte,
    )

    init_db()
    stats = sweep_popular_movies(
        args.start_year, args.end_year, per_year_limit=args.per_year, vote_count_gte=args.vote_count_gte
    )
    log.info("Backfill complete: %s", stats)
    close_db()


if __name__ == "__main__":
    main()
