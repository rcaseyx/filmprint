"""Expand the candidate pool beyond the watchlist using taste-seeded TMDB discovery."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from .tmdb import get_similar, get_recommendations, get_movie_details, discover_movies, TMDB_GENRE_IDS


def expand_candidates(
    rated_movies: list[dict],
    ratings: list[float],
    seen_ids: set[int],
    min_rating: float = 4.0,
    max_seeds: int = 15,
    max_candidates: int = 300,
    known_raw: dict[int, dict] | None = None,
) -> list[dict]:
    """
    Seed from top-rated films, fetch similar + recommended from TMDB,
    and return enriched candidates not already seen.

    min_rating: only use films rated at or above this as seeds
    max_seeds: cap how many seed films we expand from (limits API calls)
    max_candidates: cap total discovered films returned
    known_raw: pre-fetched {tmdb_id: raw_tmdb} for movies already in the DB —
               these are returned directly without a TMDB API call
    """
    seeds = sorted(
        [(m, r) for m, r in zip(rated_movies, ratings) if r >= min_rating],
        key=lambda x: x[1],
        reverse=True,
    )[:max_seeds]

    if not seeds:
        return []

    seen_ids = set(seen_ids)
    seed_ids = [movie["id"] for movie, _ in seeds]

    # Stage 1: fetch similar + recommendations for all seeds in parallel
    def _fetch_seed(seed_id: int) -> list[dict]:
        return get_similar(seed_id) + get_recommendations(seed_id)

    with ThreadPoolExecutor(max_workers=min(len(seed_ids), 8)) as pool:
        seed_results = list(pool.map(_fetch_seed, seed_ids))

    # Collect unique candidate IDs preserving discovery order
    candidate_ids: list[int] = []
    for results in seed_results:
        for result in results:
            tmdb_id = result["id"]
            if tmdb_id not in seen_ids:
                seen_ids.add(tmdb_id)
                candidate_ids.append(tmdb_id)
                if len(candidate_ids) >= max_candidates:
                    break
        if len(candidate_ids) >= max_candidates:
            break

    if not candidate_ids:
        return []

    # Stage 2: use DB-cached raw_tmdb where available; fetch the rest in parallel
    result_map: dict[int, dict] = {}
    if known_raw:
        for tid in candidate_ids:
            if tid in known_raw:
                result_map[tid] = known_raw[tid]

    to_fetch = [tid for tid in candidate_ids if tid not in result_map]
    if to_fetch:
        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = {pool.submit(get_movie_details, tid): tid for tid in to_fetch}
            for future in as_completed(futures):
                result_map[futures[future]] = future.result()

    return [result_map[tid] for tid in candidate_ids if tid in result_map]


def discover_by_mood(
    required_genres: list[str],
    existing_ids: set[int],
    max_results: int = 40,
) -> list[dict]:
    """Query TMDB Discover using mood genre filters and return fully enriched candidates.

    Runs two queries — mainstream (1000+ votes) and hidden gems (500–10k votes, higher
    rating floor) — deduplicates, then fully enriches each result. Results are cached
    to disk so repeat queries with the same genres are instant.
    """
    genre_ids = [TMDB_GENRE_IDS[g] for g in required_genres if g in TMDB_GENRE_IDS]
    if not genre_ids:
        return []

    seen = set(existing_ids)
    raw_results: list[dict] = []

    # Fetch mainstream and hidden-gem slices in parallel — each is a separate TMDB Discover call.
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_mainstream = pool.submit(discover_movies, genre_ids=genre_ids, vote_average_gte=6.5, vote_count_gte=1000)
        f_deep_cuts = pool.submit(
            discover_movies, genre_ids=genre_ids, vote_average_gte=7.2, vote_count_gte=500, vote_count_lte=10000
        )
        mainstream = f_mainstream.result()
        # Hidden gems: well-regarded but not widely seen — 500 vote floor prevents truly obscure picks
        deep_cuts = f_deep_cuts.result()

    for result in mainstream + deep_cuts:
        if result["id"] in seen:
            continue
        seen.add(result["id"])
        raw_results.append(result)
        if len(raw_results) >= max_results:
            break

    # Enrich in parallel
    ids = [r["id"] for r in raw_results]
    fetched: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(get_movie_details, tid): tid for tid in ids}
        for future in as_completed(futures):
            fetched[futures[future]] = future.result()

    return [fetched[tid] for tid in ids if tid in fetched]
