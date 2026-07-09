"""Six-degrees puzzle: bipartite movie/actor graph and shortest-path generation."""

import random
from collections import deque

from .db import get_connection

# Minimum vote_count and revenue for a movie to be eligible as a bridge in the
# puzzle graph. A popularity floor was tried here too, but TMDB's
# "popularity" is a live trending metric that decays for essentially every
# catalog title over time, not a fixed measure of fame -- it ended up
# excluding ~2400 movies with solid vote counts and real revenue (Guardians of
# the Galaxy, Jurassic Park, Moana, X-Men: First Class...) as their scores
# drifted below the threshold long after it was tuned. Requiring positive
# revenue still filters the failure mode popularity was meant to catch
# (fandom-driven direct-to-video titles with no real theatrical release, e.g.
# Mortal Kombat Legends: Scorpion's Revenge: vote_count 1477, revenue $0).
CURATED_POOL_MIN_VOTES = 1000

# Anchors are two ACTORS, not two movies (pivoted after movie-level popularity
# signals kept letting through unrecognizable anchors -- see above). Actor fame
# is derived from the movie pool itself rather than TMDB's person-popularity
# metric (same fandom-inflation problem as movie popularity): an actor with
# top-10 billing in several movies is reliably a known face. Anchors use a
# stricter, higher-vote-count movie subset than bridges/search do -- dropping
# the popularity floor above grew the general movie pool ~3.7x (892 -> 3304),
# which would otherwise pull much less recognizable names into the anchor
# pool too (e.g. Remo Girone, Stefan Gierasch). vote_count is monotonic and
# doesn't decay the way popularity does, so it stays a stable anchor-quality
# bar over time. Even at this bar, "top-10 billing in 3+ movies" alone let
# through reliable-but-not-famous character actors who rack up prominent
# supporting roles across several blockbusters without ever headlining one
# (e.g. Randall Duk Kim in Kung Fu Panda/John Wick 3/The Matrix Reloaded --
# recognizable by photo, but nobody can place which movie). Also requiring
# at least one lead-or-near-lead credit (billing <= 3) filters that out while
# keeping prolific-but-secondary actors OUT and genuine stars IN. Validated
# against real data (689 actors; weakest tier now names like Dan Aykroyd,
# Tina Fey, Kate McKinnon, John Cleese, Alexander Skarsgård -- a clear step
# up from the unfiltered top-10 tier), with healthy BFS connectivity (0/40
# sampled pairs lacked a path).
ANCHOR_MOVIE_MIN_VOTES = 5500
ACTOR_POOL_MIN_BILLING = 10
ACTOR_POOL_MIN_LEAD_BILLING = 3
ACTOR_POOL_MIN_MOVIES = 3

# Reject pairs whose shortest path is shorter than this -- a single shared
# movie is trivially guessable in one look, not a puzzle.
MIN_PUZZLE_DEGREES = 2


def get_curated_pool() -> list[int]:
    """Movie IDs eligible for a puzzle (anchors and bridges alike)."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM movies WHERE vote_count >= %s AND revenue > 0",
            (CURATED_POOL_MIN_VOTES,),
        )
        return [row["id"] for row in cur.fetchall()]


def get_curated_actor_pool(movie_pool: list[int] | None = None) -> list[int]:
    """
    Person IDs eligible as a puzzle anchor: top-billed in several movies
    from a stricter, higher-vote-count subset of the curated movie pool. Only
    anchors need this stricter bar -- bridge actors found while solving stay
    fully unrestricted (any billing order is a valid connection, rewarding
    depth of knowledge rather than penalizing it), and bridge movies use the
    full (broader) curated pool so real, well-known movies stay searchable.
    """
    pool = movie_pool if movie_pool is not None else get_curated_pool()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT mc.person_id FROM movie_credits mc
               JOIN movies m ON m.id = mc.movie_id
               WHERE mc.movie_id = ANY(%s) AND mc.billing_order <= %s AND m.vote_count >= %s
               GROUP BY mc.person_id
               HAVING count(DISTINCT mc.movie_id) >= %s AND min(mc.billing_order) <= %s""",
            (pool, ACTOR_POOL_MIN_BILLING, ANCHOR_MOVIE_MIN_VOTES, ACTOR_POOL_MIN_MOVIES, ACTOR_POOL_MIN_LEAD_BILLING),
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


def generate_puzzle(exclude_person_ids: set[int] | None = None, max_attempts: int = 500) -> dict:
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
