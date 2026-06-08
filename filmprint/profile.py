"""Build a taste profile vector from a user's rated films."""

import numpy as np
from .features import build_feature_vector


def personal_neutral(ratings: list[float]) -> float:
    """Derive the user's personal neutral rating point.

    Users who rate generously (3★ = "liked it") have a mean skewed high.
    We shift the midpoint 0.5 below the mean so those films register as
    positive rather than neutral/excluded. Clamped to [1.5, 3.0].
    """
    if not ratings:
        return 3.0
    mean = sum(ratings) / len(ratings)
    return round(max(1.5, min(3.0, mean - 0.5)), 2)


def build_critic_profile(rated_movies: list[dict], ratings: list[float]) -> dict:
    """Compute how the user's taste aligns with critics and infer a quality floor.

    Returns:
        alignment: mean delta between user rating (normalised 0-10) and IMDb score.
                   Positive = user rates higher than critics, negative = harsher.
        quality_floor: minimum IMDb score for candidates.
                       Derived from the 25th-percentile IMDb score of films the user
                       clearly liked (>= personal neutral + 1.0), minus a 1-point
                       buffer for IMDb score compression. Contrarian users get a
                       further reduction via alignment.
        neutral: the derived personal neutral rating point.
    """
    from .omdb import get_scores
    from .db import batch_get_omdb_scores

    neutral = personal_neutral(ratings)
    liked_threshold = neutral + 1.0

    # Collect all imdb_ids and batch-fetch DB cache in one query instead of N round-trips.
    imdb_ids = []
    for movie in rated_movies:
        raw = movie.get("raw_tmdb") or movie
        imdb_ids.append(raw.get("imdb_id", ""))
    scores_cache = batch_get_omdb_scores([iid for iid in imdb_ids if iid])

    deltas: list[float] = []
    liked_scores: list[float] = []

    for movie, user_rating, imdb_id in zip(rated_movies, ratings, imdb_ids):
        if not imdb_id:
            continue
        scores = scores_cache.get(imdb_id) or get_scores(imdb_id)
        if scores["imdb"] is None:
            continue

        imdb = float(scores["imdb"])
        user_normalised = user_rating * 2  # 0-5 → 0-10
        deltas.append(user_normalised - imdb)

        if user_rating >= liked_threshold:
            liked_scores.append(imdb)

    alignment = round(sum(deltas) / len(deltas), 2) if deltas else 0.0

    if liked_scores:
        liked_scores.sort()
        p25_idx = max(0, int(len(liked_scores) * 0.25))
        # 1-point buffer: IMDb scores compress — a 6.0 film can be genuinely good
        base_floor = liked_scores[p25_idx] - 1.0
    else:
        base_floor = 5.5

    adjusted_floor = round(max(4.0, min(7.5, base_floor - alignment * 0.5)), 2)

    return {"alignment": alignment, "quality_floor": adjusted_floor, "neutral": neutral}

# Bump this any time the profile algorithm changes to force a rebuild.
PROFILE_VERSION = "7.2"


def build_taste_profile(
    rated_movies: list[dict],
    ratings: list[float],
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    outcome_boosts: dict[int, float] | None = None,
    subgenre_axes: dict | None = None,
    idf: dict[str, float] | None = None,
) -> np.ndarray:
    """
    Build a taste profile using signed exponential weights around a personal neutral.

    The neutral point is derived from the rating distribution (mean - 0.5) so users
    who rate generously (3★ = liked it) still have those films pull the profile
    positively rather than being excluded as neutral.

    Weight formula: sign(r - neutral) * (r - neutral)^2 * outcome_boost
    outcome_boost > 1.0 for films that were recommended and confirmed enjoyed/disliked,
    amplifying the signal from validated recommendations.
    """
    if not rated_movies:
        raise ValueError("No rated movies to build a profile from.")

    neutral = personal_neutral(ratings)
    boosts = outcome_boosts or {}
    vectors = []
    signed_weights = []

    for movie, rating in zip(rated_movies, ratings):
        delta = rating - neutral
        if abs(delta) < 0.01:
            continue
        w = (1 if delta > 0 else -1) * delta ** 2 * boosts.get(movie["id"], 1.0)
        vec = build_feature_vector(movie, keyword_vocab, affinity, subgenre_axes, idf)
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
    outcome_boosts: dict[int, float] | None = None,
    subgenre_axes: dict | None = None,
    n_clusters: int = 3,
    idf: dict[str, float] | None = None,
) -> list[np.ndarray]:
    """
    Cluster the user's rated films into distinct taste modes using k-means,
    then build a signed-exponential profile per cluster.

    Returns a list of cluster profile vectors (may be fewer than n_clusters
    if there aren't enough non-neutral films). Returns empty list if there's
    not enough data to cluster meaningfully.
    """
    neutral = personal_neutral(ratings)
    pairs = [
        (m, r) for m, r in zip(rated_movies, ratings)
        if abs(r - neutral) >= 0.5
    ]

    if len(pairs) < n_clusters * 10:
        return []

    movies, rtgs = zip(*pairs)
    vecs = np.array([build_feature_vector(m, keyword_vocab, affinity, subgenre_axes, idf) for m in movies])

    from sklearn.cluster import KMeans
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(vecs)

    clusters = []
    for c in range(n_clusters):
        c_movies = [m for m, l in zip(movies, labels) if l == c]
        c_ratings = [r for r, l in zip(rtgs, labels) if l == c]
        if len(c_movies) >= 3:
            try:
                profile = build_taste_profile(c_movies, c_ratings, keyword_vocab, affinity, outcome_boosts, subgenre_axes, idf)
                clusters.append(profile)
            except ValueError:
                pass

    return clusters
