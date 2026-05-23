"""Build a taste profile vector from a user's rated films."""

import numpy as np
from sklearn.cluster import KMeans
from .features import build_feature_vector

# Bump this any time the profile algorithm changes to force a rebuild.
PROFILE_VERSION = "3.0"


def build_taste_profile(
    rated_movies: list[dict],
    ratings: list[float],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
) -> np.ndarray:
    """
    Build a taste profile using signed exponential weights.

    Weight formula: sign(r - 3.0) * (r - 3.0)^2
      - 5.0 stars → +4.0  (loved it, pulls profile strongly toward)
      - 4.0 stars → +1.0
      - 3.0 stars →  0.0  (neutral, excluded entirely)
      - 2.0 stars → -1.0
      - 1.0 stars → -4.0  (hated it, actively pushes profile away)
    """
    if not rated_movies:
        raise ValueError("No rated movies to build a profile from.")

    vectors = []
    signed_weights = []

    for movie, rating in zip(rated_movies, ratings):
        delta = rating - 3.0
        if abs(delta) < 0.01:
            continue
        w = (1 if delta > 0 else -1) * delta ** 2
        vec = build_feature_vector(movie, keyword_vocab, affinity)
        vectors.append(vec)
        signed_weights.append(w)

    if not vectors:
        raise ValueError("No films with non-neutral ratings to build a profile from.")

    matrix = np.array(vectors)
    w = np.array(signed_weights)
    profile = np.dot(w, matrix) / np.sum(np.abs(w))

    norm = np.linalg.norm(profile)
    return profile / norm if norm > 0 else profile


def build_taste_clusters(
    rated_movies: list[dict],
    ratings: list[float],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    n_clusters: int = 3,
) -> list[np.ndarray]:
    """
    Cluster the user's rated films into distinct taste modes using k-means,
    then build a signed-exponential profile per cluster.

    Returns a list of cluster profile vectors (may be fewer than n_clusters
    if there aren't enough non-neutral films). Returns empty list if there's
    not enough data to cluster meaningfully.
    """
    pairs = [
        (m, r) for m, r in zip(rated_movies, ratings)
        if abs(r - 3.0) >= 0.5
    ]

    if len(pairs) < n_clusters * 10:
        return []

    movies, rtgs = zip(*pairs)
    vecs = np.array([build_feature_vector(m, keyword_vocab, affinity) for m in movies])

    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(vecs)

    clusters = []
    for c in range(n_clusters):
        c_movies = [m for m, l in zip(movies, labels) if l == c]
        c_ratings = [r for r, l in zip(rtgs, labels) if l == c]
        if len(c_movies) >= 3:
            try:
                profile = build_taste_profile(c_movies, c_ratings, keyword_vocab, affinity)
                clusters.append(profile)
            except ValueError:
                pass

    return clusters
