"""Trifecta: pick 3 movie posters, get their Rotten Tomatoes scores as close
to 150 (either direction) as possible.

Scores are always looked up server-side and never trusted from the client --
the grid endpoint deliberately omits them so a round is a real blind guess,
not a visible-number selection.
"""

import json
import random
from itertools import combinations

from filmprint.db import get_connection

# 24 rather than the original 12 -- the grid is scrollable, and a bigger pool
# gives meaningfully more triples to reason about for hitting 150 (C(24,3) =
# 2024 possible combinations vs. C(12,3) = 220 at the old size).
GRID_SIZE = 24
TARGET_SUM = 150

# Same "real theatrical release, not a fandom-driven obscurity" bar used by
# Co-Star's curated pool (filmprint/six_degrees.py) -- copied rather than
# imported so the two games' pools can be tuned independently.
CURATED_POOL_MIN_VOTES = 1000

# A naive random 24-movie sample has no guarantee of even ONE exact-150
# triple, let alone several -- sampled 500 real grids from the live pool:
# 2.2% had zero solutions (literally unsolvable for an exact match) and 1.8%
# had exactly one. 3 rejects only that ~12.6% naive-sample tail and keeps
# retries cheap (resampling from the already-fetched scored pool needs no
# extra DB round trip), while guaranteeing a player always has more than one
# real path to the exact target instead of needing to stumble onto the one
# lucky triple.
MIN_SOLUTIONS = 3
MAX_GRID_ATTEMPTS = 200


def _count_solutions(scores: list[int]) -> int:
    return sum(1 for combo in combinations(scores, 3) if sum(combo) == TARGET_SUM)


_scored_pool_cache: list[tuple[int, int]] | None = None


def _load_scored_pool() -> list[tuple[int, int]]:
    """Module-level cache of (id, rt_score_int) for the whole eligible pool --
    same pattern as the other games' pool caches. Deliberately excludes
    raw_tmdb/title/year: generate_grid() used to fetch those (a multi-KB blob
    per row) for the ENTIRE ~3,200-movie pool on every single request just to
    resample from it, measured at ~4.6s per call locally, even though only
    `size` (24) of those rows ever make it into a grid. This cache holds only
    what the resampling step actually needs; generate_grid() fetches full
    details for just the 24 selected ids afterward."""
    global _scored_pool_cache
    if _scored_pool_cache is None:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT id, rt_score FROM movies
                   WHERE vote_count >= %s AND revenue > 0 AND rt_score IS NOT NULL""",
                (CURATED_POOL_MIN_VOTES,),
            )
            _scored_pool_cache = [(row["id"], int(row["rt_score"].rstrip("%"))) for row in cur.fetchall()]
    return _scored_pool_cache


def warm_pool() -> None:
    """Loads the scored movie pool eagerly rather than on the first real
    request -- called from api/main.py's startup prewarm, same pattern as the
    other games' warm_pool()s, so no live grid request pays this cost."""
    _load_scored_pool()


def generate_grid(exclude_ids: set[int] | None = None, size: int = GRID_SIZE) -> list[dict]:
    """Returns `size` movies (id, title, year, poster_path) with a real RT score,
    excluding exclude_ids, resampled until at least MIN_SOLUTIONS distinct triples
    sum to exactly TARGET_SUM. Scores are intentionally omitted from the return
    value -- hidden until reveal."""
    exclude = exclude_ids or set()
    pool = [(mid, score) for mid, score in _load_scored_pool() if mid not in exclude]

    if len(pool) < size:
        raise ValueError(f"Not enough RT-scored movies to build a grid of {size} (pool={len(pool)})")

    for _ in range(MAX_GRID_ATTEMPTS):
        sample = random.sample(pool, size)
        scores = [score for _, score in sample]
        if _count_solutions(scores) >= MIN_SOLUTIONS:
            movie_ids = [mid for mid, _ in sample]
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT id, title, year, raw_tmdb FROM movies WHERE id = ANY(%s)", (movie_ids,))
                rows = {row["id"]: row for row in cur.fetchall()}
            return [
                {
                    "id": mid,
                    "title": rows[mid]["title"],
                    "year": rows[mid]["year"],
                    "poster_path": (json.loads(rows[mid]["raw_tmdb"]) if rows[mid]["raw_tmdb"] else {}).get("poster_path"),
                }
                for mid in movie_ids
            ]

    raise ValueError(f"Could not find a grid with >= {MIN_SOLUTIONS} solutions after {MAX_GRID_ATTEMPTS} attempts")


def score_selection(movie_ids: list[int]) -> dict:
    """Validates exactly 3 distinct movies with a real RT score and scores them.

    Returns {"movies": [{id, title, rt_score}], "total": int, "distance": int}.
    """
    if len(set(movie_ids)) != 3:
        raise ValueError("Must select exactly 3 distinct movies")

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, rt_score FROM movies WHERE id = ANY(%s) AND rt_score IS NOT NULL",
            (movie_ids,),
        )
        rows = {row["id"]: row for row in cur.fetchall()}

    missing = set(movie_ids) - rows.keys()
    if missing:
        raise ValueError(f"No RT score on file for movie_id(s): {sorted(missing)}")

    movies = []
    total = 0
    for movie_id in movie_ids:
        row = rows[movie_id]
        score = int(row["rt_score"].rstrip("%"))
        total += score
        movies.append({"id": movie_id, "title": row["title"], "rt_score": score})

    return {"movies": movies, "total": total, "distance": abs(total - TARGET_SUM)}
