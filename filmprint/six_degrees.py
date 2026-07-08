"""Six-degrees daily puzzle: bipartite movie/actor graph and shortest-path generation."""

import random
from collections import deque
from datetime import date, timedelta

from .db import get_connection, get_daily_puzzle, get_recent_anchor_movie_ids, insert_daily_puzzle

# Minimum vote_count, popularity, AND revenue for a movie to be eligible as an
# anchor or bridge in the daily puzzle graph. Each guards against a different
# failure mode seen in live puzzles: vote_count alone let through movies that
# accumulated ratings over decades without staying memorable (Volcano (1997):
# vote_count 1663, popularity 4.1); popularity alone let through fandom-driven
# direct-to-video titles with no real theatrical release (Mortal Kombat
# Legends: Scorpion's Revenge: vote_count 1477, popularity 21.7, revenue $0).
# Requiring positive revenue filters out the latter -- a real release with
# marketing behind it, not just enthusiast-community engagement on TMDB.
CURATED_POOL_MIN_VOTES = 1000
CURATED_POOL_MIN_POPULARITY = 8

# Reject pairs whose shortest path is shorter than this -- a single shared
# actor is trivially guessable in one look, not a puzzle.
MIN_PUZZLE_DEGREES = 2

# Days a movie must "rest" before it can be reused as a daily anchor.
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


def generate_daily_puzzle(exclude_movie_ids: set[int] | None = None, max_attempts: int = 500) -> dict:
    """
    Pick a random start/end movie pair from the curated pool whose shortest
    path is at least MIN_PUZZLE_DEGREES, and return the puzzle details.
    Raises RuntimeError if no valid pair is found within max_attempts.
    """
    pool = get_curated_pool()
    eligible = [m for m in pool if m not in (exclude_movie_ids or set())]
    if len(eligible) < 2:
        eligible = pool

    movie_to_people, person_to_movies = build_credit_graph(pool)

    for _ in range(max_attempts):
        start_id, end_id = random.sample(eligible, 2)
        path = shortest_path(movie_to_people, person_to_movies, start_id, end_id)
        if path and len(path) >= MIN_PUZZLE_DEGREES:
            return {
                "start_movie_id": start_id,
                "end_movie_id": end_id,
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

    exclude = get_recent_anchor_movie_ids(ANCHOR_COOLDOWN_DAYS)
    puzzle = generate_daily_puzzle(exclude_movie_ids=exclude)
    puzzle["id"] = insert_daily_puzzle(
        puzzle_date,
        puzzle["start_movie_id"],
        puzzle["end_movie_id"],
        puzzle["solution_path"],
        puzzle["degree_count"],
    )
    puzzle["puzzle_date"] = puzzle_date
    return puzzle


def validate_step(movie_id: int, person_id: int, next_movie_id: int) -> bool:
    """Check whether person_id is actually credited in both movie_id and next_movie_id."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT count(DISTINCT movie_id) as c FROM movie_credits
               WHERE person_id = %s AND movie_id IN (%s, %s)""",
            (person_id, movie_id, next_movie_id),
        )
        return cur.fetchone()["c"] == 2


def search_people(query: str, limit: int = 20) -> list[dict]:
    """
    Broad, unfiltered person-name search across all credited cast -- NOT scoped
    to any particular movie. Deliberately not restricted to "correct" answers:
    scoping this to the current movie's cast would turn the dropdown itself
    into the answer key (type any letter, only valid actors appear). Callers
    must separately verify a selection is actually credited in the movie in
    question (see is_credited_in) so a real guess is still required.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT person_id, person_name, count(*) as n FROM movie_credits
               WHERE person_name ILIKE %s
               GROUP BY person_id, person_name
               ORDER BY n DESC, person_name LIMIT %s""",
            (f"%{query.strip()}%", limit),
        )
        return [{"person_id": r["person_id"], "person_name": r["person_name"]} for r in cur.fetchall()]


def search_movies(query: str, exclude_movie_ids: set[int] | None = None, limit: int = 20) -> list[int]:
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
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id FROM movies WHERE id = ANY(%s) AND title ILIKE %s
               ORDER BY popularity DESC NULLS LAST LIMIT %s""",
            (candidate_ids, f"%{query.strip()}%", limit),
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


def validate_full_chain(start_movie_id: int, end_movie_id: int, guess_hops: list[dict]) -> bool:
    """
    Validate a full player-submitted chain of {movie_id, person_id, next_movie_id}
    hops. Returns True if every hop is a real shared-actor connection (via
    validate_step) and the chain runs start_movie_id -> ... -> end_movie_id.
    """
    if not guess_hops:
        return False
    if guess_hops[0]["movie_id"] != start_movie_id:
        return False
    if guess_hops[-1]["next_movie_id"] != end_movie_id:
        return False

    for i, hop in enumerate(guess_hops):
        if i > 0 and hop["movie_id"] != guess_hops[i - 1]["next_movie_id"]:
            return False
        if not validate_step(hop["movie_id"], hop["person_id"], hop["next_movie_id"]):
            return False
    return True
