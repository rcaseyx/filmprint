"""Six-degrees daily puzzle: bipartite movie/actor graph and shortest-path generation."""

import random
from collections import deque
from datetime import date, timedelta

from .db import get_connection, get_daily_puzzle, get_recent_anchor_person_ids, insert_daily_puzzle

# Minimum vote_count, popularity, AND revenue for a movie to be eligible as a
# bridge in the daily puzzle graph. Each guards against a different failure
# mode seen in live puzzles: vote_count alone let through movies that
# accumulated ratings over decades without staying memorable (Volcano (1997):
# vote_count 1663, popularity 4.1); popularity alone let through fandom-driven
# direct-to-video titles with no real theatrical release (Mortal Kombat
# Legends: Scorpion's Revenge: vote_count 1477, popularity 21.7, revenue $0).
# Requiring positive revenue filters out the latter -- a real release with
# marketing behind it, not just enthusiast-community engagement on TMDB.
CURATED_POOL_MIN_VOTES = 1000
CURATED_POOL_MIN_POPULARITY = 8

# Anchors are two ACTORS, not two movies (pivoted after movie-level popularity
# signals kept letting through unrecognizable anchors -- see above). Actor fame
# is derived from the movie pool itself rather than TMDB's person-popularity
# metric (same fandom-inflation problem as movie popularity): an actor with
# top-10 billing in several already-curated-pool movies is reliably a known
# face, validated against real data (820 actors, weakest being names like
# Richard Gere / Tina Fey -- still solid, unlike the movie pool's weakest entries).
ACTOR_POOL_MIN_BILLING = 10
ACTOR_POOL_MIN_MOVIES = 3

# Reject pairs whose shortest path is shorter than this -- a single shared
# movie is trivially guessable in one look, not a puzzle.
MIN_PUZZLE_DEGREES = 2

# Days a person must "rest" before they can be reused as a daily anchor.
ANCHOR_COOLDOWN_DAYS = 60


def get_curated_pool() -> list[int]:
    """Movie IDs eligible for the daily puzzle (anchors and bridges alike)."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM movies WHERE vote_count >= %s AND popularity >= %s AND revenue > 0",
            (CURATED_POOL_MIN_VOTES, CURATED_POOL_MIN_POPULARITY),
        )
        return [row["id"] for row in cur.fetchall()]


def get_curated_actor_pool(movie_pool: list[int] | None = None) -> list[int]:
    """
    Person IDs eligible as a daily-puzzle anchor: top-billed in several movies
    from the curated movie pool. Only anchors need this stricter bar -- bridge
    actors found while solving stay fully unrestricted (any billing order is a
    valid connection, rewarding depth of knowledge rather than penalizing it).
    """
    pool = movie_pool if movie_pool is not None else get_curated_pool()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT person_id FROM movie_credits
               WHERE movie_id = ANY(%s) AND billing_order <= %s
               GROUP BY person_id
               HAVING count(DISTINCT movie_id) >= %s""",
            (pool, ACTOR_POOL_MIN_BILLING, ACTOR_POOL_MIN_MOVIES),
        )
        return [row["person_id"] for row in cur.fetchall()]


def build_credit_graph(pool_movie_ids: list[int]) -> tuple[dict[int, set[int]], dict[int, set[int]]]:
    """Build the bipartite movie<->person graph restricted to pool_movie_ids."""
    pool_set = set(pool_movie_ids)
    movie_to_people: dict[int, set[int]] = {mid: set() for mid in pool_set}
    person_to_movies: dict[int, set[int]] = {}

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT movie_id, person_id FROM movie_credits WHERE movie_id = ANY(%s)",
            (list(pool_set),),
        )
        for row in cur.fetchall():
            movie_id, person_id = row["movie_id"], row["person_id"]
            movie_to_people[movie_id].add(person_id)
            person_to_movies.setdefault(person_id, set()).add(movie_id)

    return movie_to_people, person_to_movies


def shortest_path(
    movie_to_people: dict[int, set[int]],
    person_to_movies: dict[int, set[int]],
    start_movie_id: int,
    end_movie_id: int,
) -> list[dict] | None:
    """
    BFS over the bipartite graph, alternating movie/actor layers.
    Returns the shortest solution as a list of hops:
    [{"movie_id": from_movie, "person_id": connecting_actor, "next_movie_id": to_movie}, ...]
    or None if no path exists (or start == end).
    """
    if start_movie_id == end_movie_id:
        return None
    if start_movie_id not in movie_to_people or end_movie_id not in movie_to_people:
        return None

    parent: dict[int, tuple[int, int]] = {}  # movie_id -> (person_id, prev_movie_id)
    visited = {start_movie_id}
    queue = deque([start_movie_id])
    found = False

    while queue and not found:
        current_movie = queue.popleft()
        for person_id in movie_to_people.get(current_movie, ()):
            for next_movie in person_to_movies.get(person_id, ()):
                if next_movie in visited:
                    continue
                visited.add(next_movie)
                parent[next_movie] = (person_id, current_movie)
                if next_movie == end_movie_id:
                    found = True
                    break
                queue.append(next_movie)
            if found:
                break

    if not found:
        return None

    path = []
    node = end_movie_id
    while node != start_movie_id:
        person_id, prev_movie = parent[node]
        path.append({"movie_id": prev_movie, "person_id": person_id, "next_movie_id": node})
        node = prev_movie
    path.reverse()
    return path


def shortest_path_between_people(
    person_to_movies: dict[int, set[int]],
    movie_to_people: dict[int, set[int]],
    start_person_id: int,
    end_person_id: int,
) -> list[dict] | None:
    """
    Mirror of shortest_path(), rooted at people instead of movies: BFS over the
    same bipartite graph, alternating actor/movie layers starting from the
    actor side. Returns hops as [{"person_id": from, "movie_id": connecting_movie,
    "next_person_id": to}, ...], or None if no path exists (or start == end).
    """
    if start_person_id == end_person_id:
        return None
    if start_person_id not in person_to_movies or end_person_id not in person_to_movies:
        return None

    parent: dict[int, tuple[int, int]] = {}  # person_id -> (movie_id, prev_person_id)
    visited = {start_person_id}
    queue = deque([start_person_id])
    found = False

    while queue and not found:
        current_person = queue.popleft()
        for movie_id in person_to_movies.get(current_person, ()):
            for next_person in movie_to_people.get(movie_id, ()):
                if next_person in visited:
                    continue
                visited.add(next_person)
                parent[next_person] = (movie_id, current_person)
                if next_person == end_person_id:
                    found = True
                    break
                queue.append(next_person)
            if found:
                break

    if not found:
        return None

    path = []
    node = end_person_id
    while node != start_person_id:
        movie_id, prev_person = parent[node]
        path.append({"person_id": prev_person, "movie_id": movie_id, "next_person_id": node})
        node = prev_person
    path.reverse()
    return path


def generate_daily_puzzle(exclude_person_ids: set[int] | None = None, max_attempts: int = 500) -> dict:
    """
    Pick a random start/end actor pair from the curated actor pool whose
    shortest path (through the curated movie pool's credit graph) is at least
    MIN_PUZZLE_DEGREES, and return the puzzle details. Raises RuntimeError if
    no valid pair is found within max_attempts.
    """
    movie_pool = get_curated_pool()
    actor_pool = get_curated_actor_pool(movie_pool)
    eligible = [p for p in actor_pool if p not in (exclude_person_ids or set())]
    if len(eligible) < 2:
        eligible = actor_pool

    movie_to_people, person_to_movies = build_credit_graph(movie_pool)

    for _ in range(max_attempts):
        start_id, end_id = random.sample(eligible, 2)
        path = shortest_path_between_people(person_to_movies, movie_to_people, start_id, end_id)
        if path and len(path) >= MIN_PUZZLE_DEGREES:
            return {
                "start_person_id": start_id,
                "end_person_id": end_id,
                "solution_path": path,
                "degree_count": len(path),
            }

    raise RuntimeError(f"Could not find a valid puzzle pair after {max_attempts} attempts")


def generate_and_store_tomorrows_puzzle() -> dict | None:
    """
    Generate and store tomorrow's daily puzzle, unless one already exists for
    that date (idempotent — safe to call from a job that might run more than
    once). Returns the inserted puzzle dict (with "id"), or None if skipped.
    """
    puzzle_date = date.today() + timedelta(days=1)
    if get_daily_puzzle(puzzle_date):
        return None

    exclude = get_recent_anchor_person_ids(ANCHOR_COOLDOWN_DAYS)
    puzzle = generate_daily_puzzle(exclude_person_ids=exclude)
    puzzle["id"] = insert_daily_puzzle(
        puzzle_date,
        puzzle["start_person_id"],
        puzzle["end_person_id"],
        puzzle["solution_path"],
        puzzle["degree_count"],
    )
    puzzle["puzzle_date"] = puzzle_date
    return puzzle


def search_people(query: str, exclude_person_ids: set[int] | None = None, limit: int = 6) -> list[dict]:
    """
    Broad, unfiltered person-name search across all credited cast -- NOT scoped
    to any particular movie. Deliberately not restricted to "correct" answers:
    scoping this to the current movie's cast would turn the dropdown itself
    into the answer key (type any letter, only valid actors appear). Callers
    must separately verify a selection is actually credited in the movie in
    question (see is_credited_in) so a real guess is still required.
    Excludes exclude_person_ids (already-visited actors in the chain).
    """
    exclude = exclude_person_ids or set()
    q = query.strip()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT person_id, person_name, max(profile_path) as profile_path, count(*) as n
               FROM movie_credits
               WHERE (person_name ILIKE %s OR person_name ILIKE %s) AND NOT (person_id = ANY(%s))
               GROUP BY person_id, person_name
               ORDER BY n DESC, person_name LIMIT %s""",
            (f"{q}%", f"% {q}%", list(exclude), limit),
        )
        return [
            {"person_id": r["person_id"], "person_name": r["person_name"], "profile_path": r["profile_path"]}
            for r in cur.fetchall()
        ]


def search_movies(query: str, exclude_movie_ids: set[int] | None = None, limit: int = 6) -> list[int]:
    """
    Broad, unfiltered movie-title search across the curated pool -- NOT scoped
    to any particular actor's filmography (same reasoning as search_people).
    Excludes exclude_movie_ids (already-visited movies in the chain).
    """
    pool = get_curated_pool()
    exclude = exclude_movie_ids or set()
    candidate_ids = [m for m in pool if m not in exclude]
    if not candidate_ids:
        return []
    q = query.strip()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id FROM movies WHERE id = ANY(%s) AND (title ILIKE %s OR title ILIKE %s)
               ORDER BY popularity DESC NULLS LAST LIMIT %s""",
            (candidate_ids, f"{q}%", f"% {q}%", limit),
        )
        return [r["id"] for r in cur.fetchall()]


def is_credited_in(movie_id: int, person_id: int) -> bool:
    """Check whether person_id is credited in movie_id at all."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM movie_credits WHERE movie_id = %s AND person_id = %s LIMIT 1",
            (movie_id, person_id),
        )
        return cur.fetchone() is not None


def share_movie(movie_id: int, person_id: int, other_person_id: int) -> bool:
    """Check whether two different people are both credited in movie_id."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT count(DISTINCT person_id) as c FROM movie_credits
               WHERE movie_id = %s AND person_id IN (%s, %s)""",
            (movie_id, person_id, other_person_id),
        )
        return cur.fetchone()["c"] == 2


def validate_full_chain(start_person_id: int, end_person_id: int, guess_hops: list[dict]) -> bool:
    """
    Validate a full player-submitted chain of {person_id, movie_id, next_person_id}
    hops. Returns True if every hop is a real shared-movie connection (via
    share_movie) and the chain runs start_person_id -> ... -> end_person_id.
    """
    if not guess_hops:
        return False
    if guess_hops[0]["person_id"] != start_person_id:
        return False
    if guess_hops[-1]["next_person_id"] != end_person_id:
        return False

    for i, hop in enumerate(guess_hops):
        if i > 0 and hop["person_id"] != guess_hops[i - 1]["next_person_id"]:
            return False
        if not share_movie(hop["movie_id"], hop["person_id"], hop["next_person_id"]):
            return False
    return True
