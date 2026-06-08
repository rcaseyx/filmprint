"""Score and rank candidates against a taste profile."""

import numpy as np
from .features import build_feature_vector

# Blend weight for the best-matching cluster score vs. global profile score.
# 0.35 means clusters can lift a strong niche match without overriding global taste.
_CLUSTER_WEIGHT = 0.35


def rank_watchlist(
    taste_profile: np.ndarray,
    candidates: list[dict],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    subgenre_axes: dict | None = None,
    clusters: list[np.ndarray] | None = None,
    idf: dict[str, float] | None = None,
) -> list[tuple[dict, float]]:
    """
    Score each candidate against the taste profile.
    Always builds full vectors (including keywords + affinity) for consistency.
    Returns (movie, score) tuples sorted by score descending.

    When clusters are provided, blends the global profile score with the
    best-matching cluster score so films that strongly fit any one taste
    facet rank higher than the flattened global profile alone would place them.
    """
    if not candidates:
        return []
    from sklearn.metrics.pairwise import cosine_similarity
    matrix = np.array([
        build_feature_vector(m, keyword_vocab, affinity, subgenre_axes, idf)
        for m in candidates
    ])
    global_scores = cosine_similarity([taste_profile], matrix)[0]

    if clusters and len(clusters) > 1:
        cluster_matrix = np.array(clusters)
        best_cluster_scores = cosine_similarity(cluster_matrix, matrix).max(axis=0)
        scores = (1 - _CLUSTER_WEIGHT) * global_scores + _CLUSTER_WEIGHT * best_cluster_scores
    else:
        scores = global_scores

    return sorted(zip(candidates, scores.tolist()), key=lambda x: x[1], reverse=True)


def diversify(
    filtered_ranked: list[tuple[dict, float]],
    full_ranked: list[tuple[dict, float]] | None = None,
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    subgenre_axes: dict | None = None,
    lam: float = 0.7,
    top_n: int = 20,
    idf: dict[str, float] | None = None,
) -> list[tuple[dict, float]]:
    """
    Reorder candidates using Maximal Marginal Relevance so the slice sent to
    Claude spans different genres/styles rather than clustering around the
    dominant taste signal.

    Builds a mixed pool: all filtered candidates + a slice of non-filtered
    films so MMR has real variety to work with even when the filter is tight.
    Genre-matched films still dominate (they have competitive relevance scores)
    but non-matched films can appear when they're meaningfully different.

    lam=1.0 → pure relevance rank order, lam=0.0 → pure diversity.
    """
    filtered_ids = {m["id"] for m, _ in filtered_ranked}
    extras = [
        (m, s) for m, s in (full_ranked or [])
        if m["id"] not in filtered_ids
    ][:top_n]

    pool = (filtered_ranked + extras)[:min(top_n * 4, len(filtered_ranked) + len(extras))]
    if len(pool) <= top_n:
        return pool

    vecs = np.array([
        build_feature_vector(movie, keyword_vocab, affinity, subgenre_axes, idf)
        for movie, _ in pool
    ])
    scores = np.array([score for _, score in pool])
    scores = scores + np.random.uniform(-0.03, 0.03, size=len(scores))

    selected: list[int] = []
    remaining = list(range(len(pool)))

    while len(selected) < top_n and remaining:
        if not selected:
            best = max(remaining, key=lambda i: scores[i])
        else:
            from sklearn.metrics.pairwise import cosine_similarity
            sel_vecs = vecs[selected]
            best = max(
                remaining,
                key=lambda i: lam * scores[i] - (1 - lam) * cosine_similarity([vecs[i]], sel_vecs).max(),
            )
        selected.append(best)
        remaining.remove(best)

    return [pool[i] for i in selected]
