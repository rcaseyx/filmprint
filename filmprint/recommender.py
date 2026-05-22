"""Score and rank watchlist movies against a taste profile."""

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from .features import build_feature_vector


def rank_watchlist(
    taste_profile: np.ndarray,
    watchlist_movies: list[dict],
) -> list[tuple[dict, float]]:
    """
    Score each watchlist movie against the taste profile.
    Returns a list of (movie, score) tuples sorted by score descending.
    """
    scored = []
    for movie in watchlist_movies:
        vec = build_feature_vector(movie)
        score = cosine_similarity([taste_profile], [vec])[0][0]
        scored.append((movie, float(score)))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored
