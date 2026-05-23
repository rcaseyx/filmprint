"""Build structured feature vectors from TMDB movie metadata."""

import json
from collections import Counter, defaultdict

import numpy as np

GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime",
    "Documentary", "Drama", "Family", "Fantasy", "History",
    "Horror", "Music", "Mystery", "Romance", "Science Fiction",
    "Thriller", "War", "Western",
]

DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"]

RUNTIME_BUCKETS = ["<90", "90-120", "120-150", "150+"]


def _raw(movie: dict) -> dict:
    """Prefer raw_tmdb when available — it has the full TMDB shape with nested dicts."""
    return movie.get("raw_tmdb") or movie


def _genre_vector(movie: dict) -> list[float]:
    genres = _raw(movie).get("genres", [])
    if isinstance(genres, str):
        genres = json.loads(genres)
    genre_names = {g["name"] if isinstance(g, dict) else g for g in genres}
    return [1.0 if g in genre_names else 0.0 for g in GENRES]


def _decade_vector(movie: dict) -> list[float]:
    raw = _raw(movie)
    release = raw.get("release_date", "") or ""
    year = raw.get("year") or (int(release[:4]) if len(release) >= 4 else None)
    vec = [0.0] * len(DECADES)
    if year:
        decade = f"{(year // 10) * 10}s"
        if decade in DECADES:
            vec[DECADES.index(decade)] = 1.0
    return vec


def _runtime_vector(movie: dict) -> list[float]:
    runtime = _raw(movie).get("runtime") or movie.get("runtime") or 0
    vec = [0.0, 0.0, 0.0, 0.0]
    if runtime < 90:
        vec[0] = 1.0
    elif runtime < 120:
        vec[1] = 1.0
    elif runtime < 150:
        vec[2] = 1.0
    else:
        vec[3] = 1.0
    return vec


def _score_vector(movie: dict) -> list[float]:
    score = (_raw(movie).get("vote_average") or movie.get("vote_average") or 0.0)
    return [score / 10.0]


def _popularity_vector(movie: dict) -> list[float]:
    pop = min((_raw(movie).get("popularity") or movie.get("popularity") or 0.0), 1000.0)
    return [pop / 1000.0]


def _keyword_vector(movie: dict, vocab: list[str]) -> list[float]:
    if not vocab:
        return []
    raw = _raw(movie)
    kw_data = raw.get("keywords", {})
    if isinstance(kw_data, str):
        kw_data = json.loads(kw_data)
    kw_list = kw_data.get("keywords", []) if isinstance(kw_data, dict) else []
    kw_names = {k["name"] if isinstance(k, dict) else k for k in kw_list}
    return [1.0 if kw in kw_names else 0.0 for kw in vocab]


def _affinity_vector(movie: dict, affinity: dict) -> list[float]:
    if not affinity:
        return [0.0, 0.0]
    raw = _raw(movie)
    directors = affinity.get("directors", {})
    actors = affinity.get("actors", {})

    crew = raw.get("credits", {}).get("crew", [])
    director_score = max(
        (directors.get(p["name"], 0.0) for p in crew if p.get("job") == "Director"),
        default=0.0,
    ) / 5.0

    cast = raw.get("credits", {}).get("cast", [])[:5]
    actor_score = max(
        (actors.get(p["name"], 0.0) for p in cast),
        default=0.0,
    ) / 5.0

    return [director_score, actor_score]


def build_keyword_vocab(rated_movies: list[dict], top_k: int = 50) -> list[str]:
    """Build a keyword vocabulary from the most common keywords across rated films."""
    counter: Counter = Counter()
    for movie in rated_movies:
        raw = _raw(movie)
        kw_data = raw.get("keywords", {})
        if isinstance(kw_data, str):
            kw_data = json.loads(kw_data)
        kw_list = kw_data.get("keywords", []) if isinstance(kw_data, dict) else []
        for kw in kw_list:
            name = kw["name"] if isinstance(kw, dict) else kw
            counter[name] += 1
    return [kw for kw, _ in counter.most_common(top_k)]


def build_affinity_scores(rated_movies: list[dict], ratings: list[float]) -> dict:
    """Compute director and actor affinity scores from rated films."""
    director_ratings: dict = defaultdict(list)
    actor_ratings: dict = defaultdict(list)

    for movie, rating in zip(rated_movies, ratings):
        raw = _raw(movie)
        crew = raw.get("credits", {}).get("crew", [])
        for person in crew:
            if person.get("job") == "Director":
                director_ratings[person["name"]].append(rating)
        cast = raw.get("credits", {}).get("cast", [])[:5]
        for actor in cast:
            actor_ratings[actor["name"]].append(rating)

    return {
        "directors": {name: float(np.mean(r)) for name, r in director_ratings.items()},
        "actors": {name: float(np.mean(r)) for name, r in actor_ratings.items()},
    }


def build_feature_vector(
    movie: dict,
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
) -> np.ndarray:
    """Combine all feature components into a single normalized vector."""
    vec = (
        _genre_vector(movie)
        + _decade_vector(movie)
        + _runtime_vector(movie)
        + _score_vector(movie)
        + _popularity_vector(movie)
        + _keyword_vector(movie, keyword_vocab or [])
        + _affinity_vector(movie, affinity or {})
    )
    arr = np.array(vec, dtype=float)
    norm = np.linalg.norm(arr)
    return arr / norm if norm > 0 else arr


def feature_labels(keyword_vocab: list[str] | None = None) -> list[str]:
    return (
        [f"genre:{g}" for g in GENRES]
        + [f"decade:{d}" for d in DECADES]
        + [f"runtime:{b}" for b in RUNTIME_BUCKETS]
        + ["score", "popularity"]
        + [f"keyword:{k}" for k in (keyword_vocab or [])]
        + ["affinity:director", "affinity:actor"]
    )


def taste_summary(profile: np.ndarray, keyword_vocab: list[str] | None = None) -> str:
    labels = feature_labels(keyword_vocab)
    top = sorted(zip(labels, profile), key=lambda x: x[1], reverse=True)[:8]
    return ", ".join(f"{label} ({score:.2f})" for label, score in top)
