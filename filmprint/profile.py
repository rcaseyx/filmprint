"""Build a taste profile vector from a user's rated films."""

import numpy as np
from .features import build_feature_vector


def build_taste_profile(
    rated_movies: list[dict],
    ratings: list[float],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
) -> np.ndarray:
    """
    Weighted average of feature vectors for rated movies.
    Higher-rated films contribute more to the profile.
    """
    if not rated_movies:
        raise ValueError("No rated movies to build a profile from.")

    vectors = []
    weights = []
    for movie, rating in zip(rated_movies, ratings):
        vec = build_feature_vector(movie, keyword_vocab, affinity)
        vectors.append(vec)
        weights.append(rating)

    matrix = np.array(vectors)
    w = np.array(weights)
    profile = np.average(matrix, axis=0, weights=w)

    norm = np.linalg.norm(profile)
    return profile / norm if norm > 0 else profile
