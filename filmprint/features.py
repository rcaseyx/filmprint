"""Build structured feature vectors from TMDB movie metadata."""

import json
from collections import Counter, defaultdict
from typing import Callable
from .themes import _NOISE_KEYWORDS

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


def _movie_keywords(movie: dict) -> set[str]:
    """Extract keyword set from a movie dict, handling all storage formats."""
    raw = _raw(movie)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raw = {}
    kw_data = (raw.get("keywords") if isinstance(raw, dict) else None) or movie.get("keywords") or []
    if isinstance(kw_data, str):
        try:
            kw_data = json.loads(kw_data)
        except (json.JSONDecodeError, TypeError):
            return set()
    if isinstance(kw_data, dict):
        kw_list = kw_data.get("keywords", [])
        return {k["name"] if isinstance(k, dict) else k for k in kw_list}
    if isinstance(kw_data, list):
        return {k["name"] if isinstance(k, dict) else k for k in kw_data}
    return set()


def _keyword_vector(movie: dict, vocab: list[str], idf: dict[str, float] | None = None) -> list[float]:
    if not vocab:
        return []
    kw_names = _movie_keywords(movie)
    if idf:
        return [idf.get(kw, 0.0) if kw in kw_names else 0.0 for kw in vocab]
    return [1.0 if kw in kw_names else 0.0 for kw in vocab]


def _axis_vector(movie: dict, axes: dict[str, list[str]]) -> list[float]:
    """Score a single movie against keyword axes (fraction of each axis's keywords matched)."""
    kw_names = _movie_keywords(movie)
    return [sum(1 for kw in keywords if kw in kw_names) / len(keywords) for keywords in axes.values()]


def _critic_scores_vector(movie: dict) -> list[float]:
    from .omdb import get_scores
    imdb_id = _raw(movie).get("imdb_id", "")
    if not imdb_id:
        return [0.0, 0.0, 0.0]
    scores = get_scores(imdb_id)
    try:
        imdb = float(scores["imdb"]) / 10.0 if scores["imdb"] else 0.0
    except (ValueError, TypeError):
        imdb = 0.0
    try:
        rt = float(str(scores["rt"]).rstrip("%")) / 100.0 if scores["rt"] else 0.0
    except (ValueError, TypeError):
        rt = 0.0
    try:
        mc = float(scores["metacritic"]) / 100.0 if scores["metacritic"] else 0.0
    except (ValueError, TypeError):
        mc = 0.0
    return [imdb, rt, mc]


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


def build_keyword_vocab(
    rated_movies: list[dict],
    top_k: int = 50,
    catalog_counts: dict[str, int] | None = None,
    total_catalog_films: int = 0,
) -> list[str]:
    """Build a keyword vocabulary from the user's rated films.

    When catalog_counts are provided, ranks by TF-IDF so keywords that are
    frequent in the user's history but rare catalog-wide (e.g. "giallo",
    "mumblecore") rank above common soft-noise keywords like "friendship".
    Falls back to raw frequency when catalog data is unavailable.
    """
    import math
    counter: Counter = Counter()
    for movie in rated_movies:
        raw = _raw(movie)
        kw_data = raw.get("keywords", {})
        if isinstance(kw_data, str):
            kw_data = json.loads(kw_data)
        kw_list = kw_data.get("keywords", []) if isinstance(kw_data, dict) else []
        for kw in kw_list:
            name = kw["name"] if isinstance(kw, dict) else kw
            lower = name.lower()
            # Also check the city part of TMDB's "city, state/country" format
            city_part = lower.split(",")[0].strip()
            if lower not in _NOISE_KEYWORDS and city_part not in _NOISE_KEYWORDS:
                counter[name] += 1

    if catalog_counts and total_catalog_films > 0:
        scored = {
            kw: count * math.log((total_catalog_films + 1) / (catalog_counts.get(kw, 0) + 1))
            for kw, count in counter.items()
        }
        return [kw for kw, _ in sorted(scored.items(), key=lambda x: x[1], reverse=True)[:top_k]]

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


def find_unexplored_directors(
    rated_movies: list[dict],
    catalog_movies: list[dict],
    min_catalog_films: int = 3,
    max_user_films: int = 0,
) -> dict[str, list[dict]]:
    """Find directors with solid catalog representation the user has rated few/no films from.

    Returns {director_name: [catalog movies]} for directors with at least
    `min_catalog_films` films in the catalog, filtered to those the user has
    rated `max_user_films` or fewer films from.
    """
    user_director_counts: dict[str, int] = defaultdict(int)
    for movie in rated_movies:
        crew = _raw(movie).get("credits", {}).get("crew", [])
        for person in crew:
            if person.get("job") == "Director":
                user_director_counts[person["name"]] += 1

    catalog_by_director: dict[str, list[dict]] = defaultdict(list)
    for movie in catalog_movies:
        crew = _raw(movie).get("credits", {}).get("crew", [])
        for person in crew:
            if person.get("job") == "Director":
                catalog_by_director[person["name"]].append(movie)

    return {
        name: movies
        for name, movies in catalog_by_director.items()
        if len(movies) >= min_catalog_films and user_director_counts.get(name, 0) <= max_user_films
    }


def build_theme_axes(keyword_themes: dict[str, str]) -> dict[str, list[str]]:
    """Invert a {keyword: theme} mapping (from the DB-backed keyword_themes table)
    into the {axis_name: [keywords]} shape used by compute_axis_scores/_axis_vector."""
    axes: dict[str, list[str]] = defaultdict(list)
    for keyword, theme in keyword_themes.items():
        axes[theme].append(keyword)
    return dict(axes)


def _facet_country(movie: dict) -> str | None:
    code = movie.get("origin_country")
    if code:
        return code
    countries = _raw(movie).get("production_countries") or []
    return countries[0]["iso_3166_1"] if countries else None


def _facet_decade(movie: dict) -> str | None:
    raw = _raw(movie)
    release = raw.get("release_date", "") or ""
    year = raw.get("year") or movie.get("year") or (int(release[:4]) if len(release) >= 4 else None)
    return f"{(year // 10) * 10}s" if year else None


def find_blind_spot_gaps(
    rated_movies: list[dict],
    catalog_movies: list[dict],
    top_axes: list[str],
    axes: dict[str, list[str]],
    facet_fn: Callable[[dict], str | None],
    min_catalog_films: int = 5,
    max_user_films: int = 1,
) -> dict[str, list[dict]]:
    """Group catalog films matching `top_axes` by an arbitrary facet (country,
    decade, ...) extracted via `facet_fn`, and return facet values with strong
    catalog presence the user has rated `max_user_films` or fewer films from
    (across their whole history, not just axis-matching films, to avoid a
    circular definition of "unexplored").
    """
    user_facet_counts: dict[str, int] = defaultdict(int)
    for movie in rated_movies:
        value = facet_fn(movie)
        if value:
            user_facet_counts[value] += 1

    axis_keywords = {kw for axis in top_axes for kw in axes.get(axis, [])}
    if not axis_keywords:
        return {}

    catalog_by_facet: dict[str, list[dict]] = defaultdict(list)
    for movie in catalog_movies:
        value = facet_fn(movie)
        if not value:
            continue
        if _movie_keywords(movie) & axis_keywords:
            catalog_by_facet[value].append(movie)

    return {
        value: movies
        for value, movies in catalog_by_facet.items()
        if len(movies) >= min_catalog_films and user_facet_counts.get(value, 0) <= max_user_films
    }


def build_feature_vector(
    movie: dict,
    keyword_vocab: list[str] | None = None,
    affinity: dict | None = None,
    subgenre_axes: dict | None = None,
    idf: dict[str, float] | None = None,
) -> np.ndarray:
    """Combine all feature components into a single normalized vector."""
    axes = subgenre_axes if subgenre_axes is not None else SUBGENRE_AXES
    vec = (
        _genre_vector(movie)
        + _decade_vector(movie)
        + _runtime_vector(movie)
        + _score_vector(movie)
        + _popularity_vector(movie)
        + _critic_scores_vector(movie)
        + _keyword_vector(movie, keyword_vocab or [], idf)
        + _affinity_vector(movie, affinity or {})
        + _axis_vector(movie, axes)
        + _axis_vector(movie, TONE_AXES)
    )
    arr = np.array(vec, dtype=float)
    norm = np.linalg.norm(arr)
    return arr / norm if norm > 0 else arr


def feature_labels(keyword_vocab: list[str] | None = None, subgenre_axes: dict | None = None) -> list[str]:
    axes = subgenre_axes if subgenre_axes is not None else SUBGENRE_AXES
    return (
        [f"genre:{g}" for g in GENRES]
        + [f"decade:{d}" for d in DECADES]
        + [f"runtime:{b}" for b in RUNTIME_BUCKETS]
        + ["score", "popularity", "critic:imdb", "critic:rt", "critic:metacritic"]
        + [f"keyword:{k}" for k in (keyword_vocab or [])]
        + ["affinity:director", "affinity:actor"]
        + [f"subgenre:{ax}" for ax in axes]
        + [f"tone:{ax}" for ax in TONE_AXES]
    )


TONE_AXES: dict[str, list[str]] = {
    "Dark": [
        "neo-noir", "gore", "serial killer", "psychopath", "supernatural horror",
        "paranoia", "prison", "murder", "nihilism", "bleak", "trauma",
        "psychological horror", "dread", "ominous",
    ],
    "Warm": [
        "hilarious", "amused", "excited", "christmas", "family", "friendship",
        "coming of age", "wholesome", "heartwarming", "uplifting", "romantic comedy",
        "inspiring", "inspirational", "joyful", "playful", "romantic",
    ],
    "Intense": [
        "suspenseful", "intense", "aggressive", "survival", "martial arts",
        "shootout", "revenge", "action hero", "chase", "battle", "heist",
    ],
    "Cerebral": [
        "psychological thriller", "whodunit", "investigation", "obsession",
        "ambiguous", "detective", "absurd", "surrealism", "dreams",
        "philosophical", "unreliable narrator",
    ],
    "Fantastical": [
        "supernatural", "alien", "magic", "time travel", "super power",
        "dystopia", "ghost", "demon", "monster", "space opera",
        "post-apocalyptic future", "wizard",
    ],
    "Melancholic": [
        "melancholy", "wistful", "longing", "grieving", "despair",
    ],
}

SUBGENRE_AXES: dict[str, list[str]] = {
    "Neo-noir": [
        "neo-noir", "detective", "whodunit", "film noir", "femme fatale",
        "hardboiled", "conspiracy",
    ],
    "Heist": [
        "heist", "robbery", "con artist", "caper", "bank robbery",
    ],
    "Survival": [
        "survival", "survival horror", "isolation", "escape",
    ],
    "Mind Bending": [
        "surrealism", "hallucination", "dreams", "amnesia",
        "psychological thriller", "unreliable narrator",
    ],
    "Espionage": [
        "spy", "espionage", "hitman", "assassin", "secret identity",
    ],
    "Occult": [
        "possession", "lovecraftian", "haunted house", "witch",
        "body horror", "occult", "exorcism",
    ],
    "Coming of Age": [
        "coming of age", "high school", "teenager", "teenage girl",
        "adolescence",
    ],
    "Revenge": [
        "revenge", "vigilante", "vengeance",
    ],
}


def compute_axis_scores(
    rated_movies: list[dict],
    ratings: list[float],
    axes: dict[str, list[str]],
) -> list[dict]:
    """Score rated films against keyword axes, weighted by rating.

    Returns [{name, weight}] sorted by weight descending, normalized to max=1.0.
    """
    from collections import defaultdict
    axis_totals: dict[str, float] = defaultdict(float)
    weight_sum = 0.0

    for movie, rating in zip(rated_movies, ratings):
        kw_names = _movie_keywords(movie)

        weight = rating / 5.0
        weight_sum += weight

        for axis, keywords in axes.items():
            hits = sum(1 for kw in keywords if kw in kw_names)
            if hits:
                axis_totals[axis] += weight * hits / len(keywords)

    if weight_sum == 0:
        return [{"name": axis, "weight": 0.0} for axis in axes]

    raw_scores = {axis: axis_totals[axis] / weight_sum for axis in axes}
    max_score = max(raw_scores.values(), default=0.01) or 0.01

    return sorted(
        [{"name": axis, "weight": round(score / max_score, 4)} for axis, score in raw_scores.items()],
        key=lambda x: x["weight"],
        reverse=True,
    )


def taste_summary(profile: np.ndarray, keyword_vocab: list[str] | None = None, subgenre_axes: dict | None = None) -> str:
    labels = feature_labels(keyword_vocab, subgenre_axes)
    top = sorted(zip(labels, profile), key=lambda x: x[1], reverse=True)[:8]
    return ", ".join(f"{label} ({score:.2f})" for label, score in top)
