"""TMDB catalog backfill — widen `movies` beyond what user Letterboxd syncs pull in.

`movies` is normally only populated when a user syncs their ratings/watchlist
(filmprint/sync.py). That means well-known movies nobody has synced yet are
absent from the catalog and can never show up in Co-Star (six-degrees) search,
bridges, or anchors. sweep_popular_movies() independently pulls popular movies
per year from TMDB's Discover endpoint so the catalog isn't solely a function
of who happens to have synced what.
"""

import logging
import math
import time

import psycopg2

from filmprint.db import get_movies_by_ids, batch_upsert_movies, close_db
from filmprint.tmdb import discover_popular_movies, get_movie_details

log = logging.getLogger(__name__)

_PAGE_SIZE = 20
_UPSERT_CHUNK_SIZE = 20
_MAX_RETRIES_PER_YEAR = 2


def sweep_popular_movies(
    start_year: int, end_year: int, per_year_limit: int = 100, vote_count_gte: int = 1000
) -> dict:
    """Pull popular movies per year from TMDB into `movies`, independent of user syncs.

    Idempotent — already-present TMDB IDs are skipped without re-fetching, so
    it's safe to re-run over overlapping or repeated year ranges.
    """
    max_pages = math.ceil(per_year_limit / _PAGE_SIZE)
    total_candidates = 0
    total_inserted = 0
    total_skipped = 0

    for year in range(end_year, start_year - 1, -1):
        for attempt in range(_MAX_RETRIES_PER_YEAR + 1):
            try:
                candidates, inserted, skipped = _sweep_year(year, per_year_limit, vote_count_gte, max_pages)
                break
            except psycopg2.OperationalError:
                if attempt == _MAX_RETRIES_PER_YEAR:
                    raise
                # Known intermittent failure mode (GitHub issue #250): Railway's
                # proxy can silently close pooled connections, and the pool
                # doesn't validate on checkout, so a stale connection can keep
                # getting handed out. close_db() drops the whole pool so the
                # next get_connection() call rebuilds it from scratch.
                log.warning(
                    "year=%d: DB connection error (attempt %d/%d) — resetting connection pool and retrying",
                    year, attempt + 1, _MAX_RETRIES_PER_YEAR,
                )
                close_db()
                time.sleep(2)

        total_candidates += candidates
        total_inserted += inserted
        total_skipped += skipped
        log.info(
            "year=%d: %d candidates, %d new, %d skipped (already present)",
            year, candidates, inserted, skipped,
        )

    return {
        "years": end_year - start_year + 1,
        "candidates": total_candidates,
        "inserted": total_inserted,
        "skipped_existing": total_skipped,
    }


def _sweep_year(year: int, per_year_limit: int, vote_count_gte: int, max_pages: int) -> tuple[int, int, int]:
    """Returns (candidates, inserted, skipped_existing) for a single year."""
    candidate_ids: list[int] = []
    for page in range(1, max_pages + 1):
        results = discover_popular_movies(year, page=page, vote_count_gte=vote_count_gte)
        if not results:
            break
        candidate_ids.extend(r["id"] for r in results)
        if len(candidate_ids) >= per_year_limit:
            break
    candidate_ids = candidate_ids[:per_year_limit]

    if not candidate_ids:
        return 0, 0, 0

    existing = get_movies_by_ids(candidate_ids)
    new_ids = [mid for mid in candidate_ids if mid not in existing]

    inserted = 0
    chunk: list[dict] = []
    for tmdb_id in new_ids:
        chunk.append(get_movie_details(tmdb_id))
        if len(chunk) >= _UPSERT_CHUNK_SIZE:
            batch_upsert_movies(chunk)
            inserted += len(chunk)
            chunk = []
    if chunk:
        batch_upsert_movies(chunk)
        inserted += len(chunk)

    return len(candidate_ids), inserted, len(candidate_ids) - len(new_ids)
