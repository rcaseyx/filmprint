"""Score and rank candidates against a taste profile."""

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from .features import build_feature_vector


def rank_watchlist(
    taste_profile: np.ndarray,
    candidates: list[dict],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
) -> list[tuple[dict, float]]:
    """
    Score each candidate against the taste profile.
    Always builds full vectors (including keywords + affinity) for consistency.
    Returns (movie, score) tuples sorted by score descending.
    """
    scored = []
    for movie in candidates:
        vec = build_feature_vector(movie, keyword_vocab, affinity)
        score = cosine_similarity([taste_profile], [vec])[0][0]
        scored.append((movie, float(score)))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored
