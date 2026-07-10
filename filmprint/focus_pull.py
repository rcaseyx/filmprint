"""Focus Pull: a small cropped square of a movie poster is shown; each wrong
guess reveals more of it (client-side animation) until the movie is
identified.

Pure game logic only -- the correct movie must never reach the client before
a correct guess, so the API layer (api/main.py) is responsible for storing
pick_round()'s movie_id/title server-side (in a per-user Redis cache, since a
user only has one active round at a time) and stripping them from what's
actually returned to the client.
"""

import json
import random

from filmprint.db import get_connection

# Same "real theatrical release, not a fandom-driven obscurity" bar used by
# Co-Star's curated pool (filmprint/six_degrees.py) -- copied rather than
# imported so each game's pool can be tuned independently.
CURATED_POOL_MIN_VOTES = 1000

# Reveal percentages after 0, 1, 2, 3, 4 wrong guesses -- the client drives
# this off the round payload rather than hardcoding game balance itself.
STAGE_REVEAL_PCTS = [14, 28, 46, 70, 100]


def _pool_rows() -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, title, year, raw_tmdb FROM movies
               WHERE vote_count >= %s AND revenue > 0
               AND (raw_tmdb::jsonb)->>'poster_path' IS NOT NULL""",
            (CURATED_POOL_MIN_VOTES,),
        )
        return cur.fetchall()


def pick_round() -> dict:
    """Returns the full round including the answer: {movie_id, title,
    poster_path, crop_x, crop_y, stages}. Caller must strip movie_id/title
    before sending to the client."""
    pool = _pool_rows()
    if not pool:
        raise ValueError("No eligible movies in the pool")

    movie = random.choice(pool)
    poster_path = json.loads(movie["raw_tmdb"]).get("poster_path")

    return {
        "movie_id": movie["id"],
        "title": movie["title"],
        "poster_path": poster_path,
        "crop_x": random.randint(20, 80),
        "crop_y": random.randint(20, 80),
        "stages": STAGE_REVEAL_PCTS,
    }


def check_guess(correct_movie_id: int, guessed_movie_id: int) -> bool:
    return correct_movie_id == guessed_movie_id


def search_movies(query: str, limit: int = 6) -> list[dict]:
    """Broad title search scoped to the pool -- same prefix-or-word-boundary
    ILIKE idiom as six_degrees.search_movies. Not restricted to the current
    round's answer (that would turn the dropdown into the answer key)."""
    pool_ids = [m["id"] for m in _pool_rows()]
    if not pool_ids:
        return []
    q = query.strip()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, title, year FROM movies
               WHERE id = ANY(%s) AND (title ILIKE %s OR title ILIKE %s)
               ORDER BY popularity DESC NULLS LAST LIMIT %s""",
            (pool_ids, f"{q}%", f"% {q}%", limit),
        )
        return [{"id": r["id"], "title": r["title"], "year": r["year"]} for r in cur.fetchall()]
