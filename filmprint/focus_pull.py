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

# Stricter than Co-Star/Trifecta's shared 1000 floor -- Focus Pull's whole
# challenge is recognizing a POSTER, unlike Co-Star/Trifecta where the movie
# title is shown directly (via search) once you have a guess. A real gap
# caught in review: "Batman: Assault on Arkham" (vote_count 1185) was drawn
# during testing -- technically a real release, not a poster most players
# would place. 5000 (1005 movies) trims that long tail while staying deep
# enough for daily replay variety.
CURATED_POOL_MIN_VOTES = 5000

# Reveal percentages after 0, 1, 2, 3, 4 wrong guesses -- the client drives
# this off the round payload rather than hardcoding game balance itself.
# Starting stage raised from 14 -- real play testing found it too tight,
# making the first guess pure guesswork rather than an actual first clue.
STAGE_REVEAL_PCTS = [25, 44, 62, 81, 100]


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
    round's answer (that would turn the dropdown into the answer key).

    Applies the pool filter directly in this query rather than reusing
    _pool_rows() -- that helper also selects raw_tmdb (a multi-KB JSON blob)
    for every one of the ~4000 pool movies just to get IDs, which made every
    keystroke of a live search take 5-6s. This query never touches raw_tmdb.
    """
    q = query.strip()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, title, year FROM movies
               WHERE vote_count >= %s AND revenue > 0
               AND (raw_tmdb::jsonb)->>'poster_path' IS NOT NULL
               AND (title ILIKE %s OR title ILIKE %s)
               ORDER BY popularity DESC NULLS LAST LIMIT %s""",
            (CURATED_POOL_MIN_VOTES, f"{q}%", f"% {q}%", limit),
        )
        return [{"id": r["id"], "title": r["title"], "year": r["year"]} for r in cur.fetchall()]
