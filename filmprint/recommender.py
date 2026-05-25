"""Score and rank candidates against a taste profile."""

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from .features import build_feature_vector


def rank_watchlist(
    taste_profile: np.ndarray,
    candidates: list[dict],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    subgenre_axes: dict | None = None,
) -> list[tuple[dict, float]]:
    """
    Score each candidate against the taste profile.
    Always builds full vectors (including keywords + affinity) for consistency.
    Returns (movie, score) tuples sorted by score descending.
    """
    scored = []
    for movie in candidates:
        vec = build_feature_vector(movie, keyword_vocab, affinity, subgenre_axes)
        score = cosine_similarity([taste_profile], [vec])[0][0]
        scored.append((movie, float(score)))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def diversify(
    filtered_ranked: list[tuple[dict, float]],
    full_ranked: list[tuple[dict, float]] | None = None,
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    subgenre_axes: dict | None = None,
    lam: float = 0.7,
    top_n: int = 20,
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
        build_feature_vector(movie, keyword_vocab, affinity, subgenre_axes)
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
            sel_vecs = vecs[selected]
            best = max(
                remaining,
                key=lambda i: lam * scores[i] - (1 - lam) * cosine_similarity([vecs[i]], sel_vecs).max(),
            )
        selected.append(best)
        remaining.remove(best)

    return [pool[i] for i in selected]
