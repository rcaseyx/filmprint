"""Expand the candidate pool beyond the watchlist using taste-seeded TMDB discovery."""

from .tmdb import get_similar, get_recommendations, get_movie_details


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
