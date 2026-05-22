"""Build structured feature vectors from TMDB movie metadata."""

import numpy as np

GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime",
    "Documentary", "Drama", "Family", "Fantasy", "History",
    "Horror", "Music", "Mystery", "Romance", "Science Fiction",
    "Thriller", "War", "Western",
]

DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"]

RUNTIME_BUCKETS = ["<90", "90-120", "120-150", "150+"]


def _genre_vector(movie: dict) -> list[float]:
    genre_names = {g["name"] for g in movie.get("genres", [])}
    return [1.0 if g in genre_names else 0.0 for g in GENRES]


def _decade_vector(movie: dict) -> list[float]:
    release = movie.get("release_date", "")
    year = int(release[:4]) if release and len(release) >= 4 else None
    vec = [0.0] * len(DECADES)
    if year:
        decade = f"{(year // 10) * 10}s"
        if decade in DECADES:
            vec[DECADES.index(decade)] = 1.0
    return vec


def _runtime_vector(movie: dict) -> list[float]:
    runtime = movie.get("runtime") or 0
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
    score = movie.get("vote_average", 0.0)
    return [score / 10.0]


def _popularity_vector(movie: dict) -> list[float]:
    # Normalize popularity to 0-1 range (TMDB popularity can be very large)
    pop = min(movie.get("popularity", 0.0), 1000.0)
    return [pop / 1000.0]


def build_feature_vector(movie: dict) -> np.ndarray:
    """Combine all feature components into a single normalized vector."""
    vec = (
        _genre_vector(movie)
        + _decade_vector(movie)
        + _runtime_vector(movie)
        + _score_vector(movie)
        + _popularity_vector(movie)
    )
    arr = np.array(vec, dtype=float)
    norm = np.linalg.norm(arr)
    return arr / norm if norm > 0 else arr


def feature_labels() -> list[str]:
    """Return human-readable labels for each position in the feature vector."""
    return (
        [f"genre:{g}" for g in GENRES]
        + [f"decade:{d}" for d in DECADES]
        + [f"runtime:{b}" for b in RUNTIME_BUCKETS]
        + ["score", "popularity"]
    )
