"""Common Thread: 3 movie posters are shown; guess the actor common to all 3.

Pure game logic only -- same convention as filmprint.focus_pull: the API
layer (api/main.py) stores pick_round()'s person_id/person_name/
common_actors/movies server-side (per-user Redis cache) and strips them from
what's returned to the client.
"""

import json
import random

from filmprint.db import get_connection

# Looser than Co-Star's anchor bar (billing <= 3, since Co-Star needs a name
# recognizable cold) but stricter than "any credited role" -- validated
# against production: billing<=10 let in 3593 actors, including plenty of
# deep-bench ensemble/background players nobody would place in 3 posters;
# billing<=6 (2404 actors) stays to genuine supporting-or-better roles while
# keeping a healthy, varied pool.
MIN_BILLING_ORDER = 6

# billing<=6 alone still isn't enough to guarantee an ACTOR is recognizable,
# only that their ROLE was substantial -- real example caught in review:
# Celeste O'Connor qualified (Freaky billing 2, Madame Web billing 3,
# Ghostbusters: Afterlife billing 5) despite not being a widely recognized
# name/face, the same "prominent role in a big movie != personal fame"
# failure mode Co-Star hit with Mekhi Phifer/Talitha Eliana Bateman. Reusing
# Co-Star's exact validated fix here: a much higher vote_count floor
# specifically for actor qualification (ANCHOR_MOVIE_MIN_VOTES in
# six_degrees.py) -- at 5500 it drops Celeste O'Connor to 0 qualifying movies
# (all 4 of her credits are below it) while the resulting pool (2404 -> 652)
# is still uniformly recognizable (Keanu Reeves, Lupita Nyong'o, Rihanna,
# Emilia Clarke tier) on a real sample. This also raises the prominence of
# the shown posters as a side effect, since pick_round() only ever draws
# from an actor's qualifying movie_ids.
ACTOR_QUALIFYING_MIN_VOTES = 5500

MIN_QUALIFYING_MOVIES = 3

# The 3 shown posters are sampled from each actor's TOP_N_BY_VOTES most-voted
# qualifying movies, not uniformly across their whole filmography -- an actor
# being well-known doesn't mean every one of their credits is (validated
# against production: John Goodman qualifies with 29 movies ranging from
# Monsters, Inc. (vote_count 19745) down to The Jungle Book 2 (1202); a
# uniform pick across all 29 would surface his obscure catalog roles just as
# often as Monsters, Inc. or The Big Lebowski). vote_count, not TMDB
# popularity -- popularity is a decaying trending metric, not a fame measure
# (bitten twice on this elsewhere in the app).
TOP_N_BY_VOTES = 8

# Fallback window when an actor's top-8-by-votes collapses below 3 movies
# after franchise dedup. Previously fell back to the actor's ENTIRE qualifying
# filmography (could be dozens of movies), silently reintroducing the exact
# "obscure sequel as likely as the famous role" problem TOP_N_BY_VOTES was
# built to prevent for franchise-heavy actors. 20 stays ranked by vote_count
# (unlike the unbounded fallback) and gives real room past the top 8 without
# reaching into an actor's deep-bench catalog -- if even the top 20 doesn't
# clear 3 distinct-franchise movies, pick_round() correctly moves on to a
# different actor instead.
FALLBACK_TOP_N_BY_VOTES = 20


def _qualifying_actors() -> list[dict]:
    """Actors credited (billing <= MIN_BILLING_ORDER) in >= 3 curated,
    poster-having movies. Returns [{person_id, person_name, movie_ids}]."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT mc.person_id, max(mc.person_name) as person_name,
                      array_agg(DISTINCT mc.movie_id) as movie_ids
               FROM movie_credits mc
               JOIN movies m ON m.id = mc.movie_id
               WHERE m.vote_count >= %s AND m.revenue > 0
                 AND (m.raw_tmdb::jsonb)->>'poster_path' IS NOT NULL
                 AND mc.billing_order <= %s
               GROUP BY mc.person_id
               HAVING count(DISTINCT mc.movie_id) >= %s""",
            (ACTOR_QUALIFYING_MIN_VOTES, MIN_BILLING_ORDER, MIN_QUALIFYING_MOVIES),
        )
        return [
            {"person_id": r["person_id"], "person_name": r["person_name"], "movie_ids": r["movie_ids"]}
            for r in cur.fetchall()
        ]


_actors_cache: list[dict] | None = None


def _load_qualifying_actors() -> list[dict]:
    """Module-level cache of _qualifying_actors(), built once per process --
    same pattern as six_degrees/trivia's pool caches. Measured at ~0.5s per
    call locally (likely worse over Railway's Postgres proxy); pick_round()
    used to pay this on every single "New round" click."""
    global _actors_cache
    if _actors_cache is None:
        _actors_cache = _qualifying_actors()
    return _actors_cache


def warm_pool() -> None:
    """Loads the qualifying-actor pool eagerly rather than on the first real
    request -- called from api/main.py's startup prewarm, same pattern as
    six_degrees/trivia's warm_pool(), so no live round request pays this cost."""
    _load_qualifying_actors()


def _movies_for(movie_ids: list[int]) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, title, raw_tmdb FROM movies WHERE id = ANY(%s)", (movie_ids,))
        rows = {r["id"]: r for r in cur.fetchall()}
    return [
        {
            "id": mid,
            "title": rows[mid]["title"],
            "poster_path": json.loads(rows[mid]["raw_tmdb"]).get("poster_path"),
        }
        for mid in movie_ids
    ]


def _top_by_votes(movie_ids: list[int], top_n: int) -> list[int]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM movies WHERE id = ANY(%s) ORDER BY vote_count DESC LIMIT %s",
            (movie_ids, top_n),
        )
        return [r["id"] for r in cur.fetchall()]


def _dedupe_by_collection(movie_ids: list[int]) -> list[int]:
    """Keep at most one movie per TMDB collection (franchise). Sequels almost
    always share their entire main cast, which both makes the puzzle
    trivially readable off the poster text (three Fifty Shades posters in a
    row) and breaks the "one correct actor" assumption -- 11 actors turned
    out to be common to a real 3-Fifty-Shades-movie draw, not just the two
    leads. Input order is preserved, so the caller controls which entry of a
    franchise survives (e.g. _top_by_votes already orders by prominence)."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, raw_tmdb FROM movies WHERE id = ANY(%s)", (movie_ids,))
        rows = {r["id"]: r for r in cur.fetchall()}

    seen_collections = set()
    deduped = []
    for mid in movie_ids:
        raw = json.loads(rows[mid]["raw_tmdb"]) if rows[mid]["raw_tmdb"] else {}
        collection = raw.get("belongs_to_collection")
        collection_id = collection.get("id") if collection else None
        if collection_id is not None and collection_id in seen_collections:
            continue
        if collection_id is not None:
            seen_collections.add(collection_id)
        deduped.append(mid)
    return deduped


def _common_actors(movie_ids: list[int]) -> list[dict]:
    """All actors credited in every one of movie_ids, not just the one
    originally used to find this triple -- see _dedupe_by_collection's
    docstring for why relying on a single "correct" actor is unsafe."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT person_id, max(person_name) as person_name
               FROM movie_credits WHERE movie_id = ANY(%s)
               GROUP BY person_id HAVING count(DISTINCT movie_id) = %s""",
            (movie_ids, len(movie_ids)),
        )
        return [{"person_id": r["person_id"], "person_name": r["person_name"]} for r in cur.fetchall()]


# Some actors only qualify via a single trilogy (their sole 3+ credits above
# ACTOR_QUALIFYING_MIN_VOTES are all one franchise -- Fifty Shades' own leads
# are a real example), so _dedupe_by_collection can legitimately leave fewer
# than 3 movies for that particular actor. Retry with a different actor
# rather than failing the whole round; the pool (652 actors) is deep enough
# that this resolves within a few attempts in practice.
MAX_ACTOR_ATTEMPTS = 25


def pick_round() -> dict:
    """Returns the full round including the answer: {person_id, person_name,
    common_actors, movies: [{id, title, poster_path}, x3]}. Caller must strip
    person_id/person_name/common_actors/id/title before sending to the
    client. common_actors is every actor credited in all 3 movies (not just
    person_id) -- a guess matching any of them should count as correct."""
    actors = list(_load_qualifying_actors())
    if not actors:
        raise ValueError("No eligible actors in the pool")

    # Copied above before shuffling -- _load_qualifying_actors() returns the
    # same shared cached list on every call, and shuffling it in place would
    # race with any other concurrent pick_round() call shuffling that same
    # underlying object.
    random.shuffle(actors)
    for actor in actors[:MAX_ACTOR_ATTEMPTS]:
        prominent_ids = _dedupe_by_collection(_top_by_votes(actor["movie_ids"], TOP_N_BY_VOTES))
        if len(prominent_ids) < MIN_QUALIFYING_MOVIES:
            prominent_ids = _dedupe_by_collection(_top_by_votes(actor["movie_ids"], FALLBACK_TOP_N_BY_VOTES))
        if len(prominent_ids) >= MIN_QUALIFYING_MOVIES:
            break
    else:
        raise ValueError("Could not find an actor with 3 movies from distinct franchises")

    movie_ids = random.sample(prominent_ids, MIN_QUALIFYING_MOVIES)
    movies = _movies_for(movie_ids)
    random.shuffle(movies)

    return {
        "person_id": actor["person_id"],
        "person_name": actor["person_name"],
        "common_actors": _common_actors(movie_ids),
        "movies": movies,
    }


def check_guess(common_actors: list[dict], guessed_person_id: int) -> dict | None:
    """Returns the matched {person_id, person_name} if guessed_person_id is
    any actor common to all 3 shown movies, or None if it isn't."""
    return next((a for a in common_actors if a["person_id"] == guessed_person_id), None)


def search_actors(query: str, limit: int = 6) -> list[dict]:
    """Broad person-name search across all credited cast -- same
    prefix-or-word-boundary ILIKE idiom as six_degrees.search_people. Not
    restricted to the current round's answer."""
    q = query.strip()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT person_id, person_name, max(profile_path) as profile_path, count(*) as n
               FROM movie_credits
               WHERE person_name ILIKE %s OR person_name ILIKE %s
               GROUP BY person_id, person_name
               ORDER BY n DESC, person_name LIMIT %s""",
            (f"{q}%", f"% {q}%", limit),
        )
        return [
            {"person_id": r["person_id"], "person_name": r["person_name"], "profile_path": r["profile_path"]}
            for r in cur.fetchall()
        ]
