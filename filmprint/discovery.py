"""Expand the candidate pool beyond the watchlist using taste-seeded TMDB discovery."""

from .tmdb import get_similar, get_recommendations, get_movie_details, discover_movies, TMDB_GENRE_IDS


def expand_candidates(
    rated_movies: list[dict],
    ratings: list[float],
    seen_ids: set[int],
    min_rating: float = 4.0,
    max_seeds: int = 15,
    max_candidates: int = 300,
) -> list[dict]:
    """
    Seed from top-rated films, fetch similar + recommended from TMDB,
    and return enriched candidates not already seen.

    min_rating: only use films rated at or above this as seeds
    max_seeds: cap how many seed films we expand from (limits API calls)
    max_candidates: cap total discovered films returned
    """
    # Sort by rating descending, take the top seeds
    seeds = sorted(
        [(m, r) for m, r in zip(rated_movies, ratings) if r >= min_rating],
        key=lambda x: x[1],
        reverse=True,
    )[:max_seeds]

    if not seeds:
        return []

    seen_ids = set(seen_ids)  # copy so we don't mutate the caller's set
    candidates = []

    for movie, _ in seeds:
        seed_id = movie["id"]
        raw = get_similar(seed_id) + get_recommendations(seed_id)

        for result in raw:
            tmdb_id = result["id"]
            if tmdb_id in seen_ids:
                continue

            seen_ids.add(tmdb_id)
            enriched = get_movie_details(tmdb_id)
            candidates.append(enriched)

            if len(candidates) >= max_candidates:
                return candidates

    return candidates


def discover_by_mood(
    required_genres: list[str],
    existing_ids: set[int],
    max_results: int = 40,
) -> list[dict]:
    """Query TMDB Discover using mood genre filters and return fully enriched candidates.

    Runs two queries — mainstream (high vote count) and deep cuts (lower vote count,
    higher rating floor) — deduplicates, then fully enriches each result. Results are
    cached to disk so repeat queries with the same genres are instant.
    """
    genre_ids = [TMDB_GENRE_IDS[g] for g in required_genres if g in TMDB_GENRE_IDS]
    if not genre_ids:
        return []

    seen = set(existing_ids)
    raw_results: list[dict] = []

    mainstream = discover_movies(genre_ids=genre_ids, vote_average_gte=6.5, vote_count_gte=300)
    deep_cuts = discover_movies(
        genre_ids=genre_ids, vote_average_gte=7.2, vote_count_gte=50, vote_count_lte=2000
    )

    for result in mainstream + deep_cuts:
        if result["id"] in seen:
            continue
        seen.add(result["id"])
        raw_results.append(result)
        if len(raw_results) >= max_results:
            break

    return [get_movie_details(r["id"]) for r in raw_results]
