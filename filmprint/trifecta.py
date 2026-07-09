"""Trifecta: pick 3 movie posters, get their Rotten Tomatoes scores as close
to 150 (either direction) as possible.

Scores are always looked up server-side and never trusted from the client --
the grid endpoint deliberately omits them so a round is a real blind guess,
not a visible-number selection.
"""

import json
import random

from filmprint.db import get_connection

GRID_SIZE = 12
TARGET_SUM = 150

# Same "real theatrical release, not a fandom-driven obscurity" bar used by
# Co-Star's curated pool (filmprint/six_degrees.py) -- copied rather than
# imported so the two games' pools can be tuned independently.
CURATED_POOL_MIN_VOTES = 1000


def generate_grid(exclude_ids: set[int] | None = None, size: int = GRID_SIZE) -> list[dict]:
    """Returns `size` movies (id, title, year, poster_path) with a real RT score,
    excluding exclude_ids. Scores are intentionally omitted here -- hidden until reveal."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, title, year, raw_tmdb FROM movies
               WHERE vote_count >= %s AND revenue > 0 AND rt_score IS NOT NULL
               AND id != ALL(%s)""",
            (CURATED_POOL_MIN_VOTES, list(exclude_ids or [])),
        )
        pool = cur.fetchall()

    if len(pool) < size:
        raise ValueError(f"Not enough RT-scored movies to build a grid of {size} (pool={len(pool)})")

    sample = random.sample(pool, size)
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "year": row["year"],
            "poster_path": (json.loads(row["raw_tmdb"]) if row["raw_tmdb"] else {}).get("poster_path"),
        }
        for row in sample
    ]


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
