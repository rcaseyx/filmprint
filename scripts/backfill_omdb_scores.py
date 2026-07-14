"""
One-off recovery script: backfill OMDB critic scores (IMDb/RT/Metacritic) for
every movie missing them.

Written after the 2026-07-14 incident (see
/Users/rcaseyx/projects/filmprint-data-recovery-plan.md). scripts/
restore_movies_from_cache.py repopulated `movies` from the local TMDB cache,
but OMDB scores (imdb_score, rt_score, mc_score, omdb_fetched_at columns on
movies) come from a separate API and weren't part of that cache -- every
restored movie has omdb_fetched_at IS NULL.

This matters beyond just missing data: filmprint.features._critic_scores_vector()
calls filmprint.omdb.get_scores() synchronously, one movie at a time, with no
batching. Left unbackfilled, the first real profile rebuild would trigger
thousands of blocking, uncached OMDB calls serially inside a single request.

Threaded like the existing /api/admin/warm-cache endpoint (5 workers by
default). Loops get_imdb_ids_missing_omdb() until nothing's left, since it
caps out at 2000 per call. Detects stalled progress (e.g. OMDB rate-limiting
or an API failure) by comparing consecutive batches -- if the same batch of
ids comes back unchanged, stops rather than looping forever; re-running the
script later resumes where it left off, since already-fetched movies are
excluded by omdb_fetched_at IS NOT NULL.

Per-id retry on connection errors, same pattern as
filmprint.catalog.sweep_popular_movies (see its comment re: GitHub issue
#250) -- Railway's proxy can silently close pooled connections, and the pool
doesn't validate on checkout, so a stale connection can keep getting handed
out. Without this, one flaky connection mid-batch crashes the whole run
instead of just that one lookup.

Catches both psycopg2.OperationalError (the stale-connection symptom) and
psycopg2.pool.PoolError (a second symptom specific to concurrent workers:
filmprint.db.close_db() isn't lock-protected, so when one worker thread
resets the shared pool while another thread is mid-checkout on the old pool
object, that thread sees "connection pool is closed" instead of
OperationalError -- a real race hit while developing this script with 5
concurrent workers).

Usage:
    python scripts/backfill_omdb_scores.py [--workers 5]
"""

import argparse
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg2
import psycopg2.pool
from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, get_imdb_ids_missing_omdb, close_db
from filmprint.omdb import get_scores

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

_MAX_RETRIES_PER_ID = 2


def _fetch_with_retry(imdb_id: str) -> None:
    for attempt in range(_MAX_RETRIES_PER_ID + 1):
        try:
            get_scores(imdb_id)
            return
        except (psycopg2.OperationalError, psycopg2.pool.PoolError):
            if attempt == _MAX_RETRIES_PER_ID:
                log.warning(
                    "Giving up on %s after %d attempts (connection errors) -- "
                    "will be retried on next script run",
                    imdb_id, attempt + 1,
                )
                return
            close_db()
            time.sleep(2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()

    init_db()

    total = 0
    t0 = time.time()
    prev_batch: list[str] | None = None
    while True:
        imdb_ids = get_imdb_ids_missing_omdb()
        if not imdb_ids:
            break
        if imdb_ids == prev_batch:
            log.error(
                "No progress since last batch (%d ids) -- OMDB API likely "
                "rate-limited or failing. Stopping. Re-run this script later "
                "to resume; already-fetched movies are skipped.",
                len(imdb_ids),
            )
            break

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(_fetch_with_retry, imdb_ids))

        total += len(imdb_ids)
        log.info("Fetched %d so far (%.1fs elapsed)", total, time.time() - t0)
        prev_batch = imdb_ids

    log.info("Done. Backfilled OMDB scores for %d movies this run.", total)
    close_db()


if __name__ == "__main__":
    main()
