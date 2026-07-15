"""Focus Pull: a pixelated movie poster is shown; each wrong guess renders it
one stage sharper (server-side, via Pillow) until the movie is identified.

Pure game logic only -- the correct movie must never reach the client before
a correct guess, so the API layer (api/main.py) is responsible for storing
pick_round()'s movie_id/title server-side (in a per-user Redis cache, since a
user only has one active round at a time) and stripping them from what's
actually returned to the client. The poster image itself is served through a
separate unauthenticated endpoint (render_poster below, wired to
/api/games/focus-pull/poster) since a plain <img>/<Image> tag can't send an
Authorization header -- this matches the pre-existing posture where the raw
poster was already visible to the client (via TMDB directly) at every stage,
just CSS-obscured.
"""

import json
import random
from io import BytesIO

import requests
from PIL import Image

from filmprint.db import get_connection

TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w780"

# Stricter than Co-Star/Trifecta's shared 1000 floor -- Focus Pull's whole
# challenge is recognizing a POSTER, unlike Co-Star/Trifecta where the movie
# title is shown directly (via search) once you have a guess. A real gap
# caught in review: "Batman: Assault on Arkham" (vote_count 1185) was drawn
# during testing -- technically a real release, not a poster most players
# would place. 5000 (1005 movies) trims that long tail while staying deep
# enough for daily replay variety.
CURATED_POOL_MIN_VOTES = 5000

# Pixel-grid width (in blocks) after 0, 1, 2, 3, 4 wrong guesses -- the client
# drives progression off the round payload rather than hardcoding game
# balance itself. 0 means "no pixelation, full resolution". Starting stage
# went 3 -> 10 -> 6: 3 was a solid color block (pure guesswork), 10 turned
# out too easy on first render (still recognizable at a glance), 6 is the
# current middle ground -- a real clue (rough shapes/color blocking) without
# giving away the poster immediately.
STAGE_PIXEL_BLOCKS = [6, 16, 24, 36, 0]

# In-process cache of rendered stage images, keyed by (poster_path, stage).
# Bounded to a few hundred entries -- the curated pool is ~1000 posters x 5
# stages, but only a small slice is in daily rotation at once. Resets on
# deploy; that's fine, re-rendering is cheap and the client also gets a
# long-lived Cache-Control header per image.
_render_cache: dict[tuple[str, int], bytes] = {}
_RENDER_CACHE_MAX = 500


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
    poster_path, stages}. Caller must strip movie_id/title before sending to
    the client."""
    pool = _pool_rows()
    if not pool:
        raise ValueError("No eligible movies in the pool")

    movie = random.choice(pool)
    poster_path = json.loads(movie["raw_tmdb"]).get("poster_path")

    return {
        "movie_id": movie["id"],
        "title": movie["title"],
        "poster_path": poster_path,
        "stages": STAGE_PIXEL_BLOCKS,
    }


def check_guess(correct_movie_id: int, guessed_movie_id: int) -> bool:
    return correct_movie_id == guessed_movie_id


def render_poster(poster_path: str, stage: int) -> bytes:
    """Fetches the TMDB poster and pixelates it to the given stage's block
    count (0 = full resolution). Downscaling with BILINEAR then upscaling
    with NEAREST is what produces the blocky look -- BILINEAR averages each
    block's source pixels into one flat color, NEAREST then blows each of
    those flat colors back up into a crisp square instead of blurring them."""
    stage = max(0, min(stage, len(STAGE_PIXEL_BLOCKS) - 1))
    blocks = STAGE_PIXEL_BLOCKS[stage]

    cache_key = (poster_path, stage)
    cached = _render_cache.get(cache_key)
    if cached is not None:
        return cached

    resp = requests.get(f"{TMDB_IMG_BASE}{poster_path}", timeout=10)
    resp.raise_for_status()
    img = Image.open(BytesIO(resp.content)).convert("RGB")

    if blocks:
        w, h = img.size
        small_w = max(1, blocks)
        small_h = max(1, round(blocks * h / w))
        img = img.resize((small_w, small_h), Image.BILINEAR).resize((w, h), Image.NEAREST)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    rendered = buf.getvalue()

    if len(_render_cache) >= _RENDER_CACHE_MAX:
        _render_cache.pop(next(iter(_render_cache)))
    _render_cache[cache_key] = rendered
    return rendered


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
