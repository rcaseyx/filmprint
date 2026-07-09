"""TMDB API client — movie search and metadata enrichment."""

import json
import os
import requests
from pathlib import Path

BASE_URL = "https://api.themoviedb.org/3"
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"

# Maps genre names (as used in our feature vectors) to TMDB genre IDs
TMDB_GENRE_IDS: dict[str, int] = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35,
    "Crime": 80, "Documentary": 99, "Drama": 18, "Family": 10751,
    "Fantasy": 14, "History": 36, "Horror": 27, "Music": 10402,
    "Mystery": 9648, "Romance": 10749, "Science Fiction": 878,
    "Thriller": 53, "War": 10752, "Western": 37,
}


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _cached_get(cache_key: str, endpoint: str, params: dict = {}, use_cache: bool = True) -> dict:
    """Fetch from cache if available, otherwise hit the API and cache the result.

    use_cache=False skips both the read and the write — needed for queries whose
    results change over time (e.g. popularity-ranked discover pages), where a
    stale cached page would silently hide newly-qualifying results forever.
    """
    path = _cache_path(cache_key)
    if use_cache and path.exists():
        return json.loads(path.read_text())

    params = {**params, "api_key": os.environ["TMDB_API_KEY"]}
    response = requests.get(f"{BASE_URL}{endpoint}", params=params)
    response.raise_for_status()
    data = response.json()

    if use_cache:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
    return data


def search_movie(title: str, year: int | None = None) -> dict | None:
    """Search for a movie by title and optional year, return best match."""
    params = {"query": title, "include_adult": False}
    if year:
        params["year"] = year
    key = f"search_{title}_{year}".replace(" ", "_").lower()
    results = _cached_get(key, "/search/movie", params).get("results", [])
    return results[0] if results else None


def get_movie_details(tmdb_id: int) -> dict:
    """Fetch full movie details including genres, keywords, and credits."""
    return _cached_get(
        f"movie_{tmdb_id}",
        f"/movie/{tmdb_id}",
        {"append_to_response": "keywords,credits"},
    )


def get_similar(tmdb_id: int) -> list[dict]:
    """Fetch TMDB's similar films for a given movie."""
    data = _cached_get(f"similar_{tmdb_id}", f"/movie/{tmdb_id}/similar")
    return data.get("results", [])


def get_recommendations(tmdb_id: int) -> list[dict]:
    """Fetch TMDB's recommended films for a given movie."""
    data = _cached_get(f"recommendations_{tmdb_id}", f"/movie/{tmdb_id}/recommendations")
    return data.get("results", [])


def _normalize_provider_name(name: str) -> str:
    """Strip distribution-channel suffixes so AMC+/AMC+ Amazon Channel/AMC Plus Apple TV Channel all collapse to 'AMC+'."""
    import re
    name = name.strip()
    name = re.sub(r"\s+(Amazon Channel|Apple TV Channel|with Ads)$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+Plus\b", "+", name)  # "AMC Plus" -> "AMC+", consuming the preceding space
    return name.strip()


def get_watch_providers(tmdb_id: int, country: str = "US") -> list[dict]:
    """Return deduplicated flatrate (streaming) providers for a film in the given country.

    Deduplicates by normalized provider name so that e.g. 'AMC+', 'AMC+ Amazon Channel',
    and 'AMC Plus Apple TV Channel' collapse to a single entry.
    """
    data = _cached_get(f"providers_{tmdb_id}", f"/movie/{tmdb_id}/watch/providers")
    region = data.get("results", {}).get(country, {})
    # Sort by raw name length so canonical short names ("AMC+") beat channel variants
    # ("AMC+ Amazon Channel", "AMC Plus Apple TV Channel") during deduplication.
    flatrate = sorted(region.get("flatrate", []), key=lambda p: len(p["provider_name"]))
    seen_names: set[str] = set()
    providers = []
    for p in flatrate:
        normalized = _normalize_provider_name(p["provider_name"])
        if normalized not in seen_names:
            seen_names.add(normalized)
            providers.append({"name": normalized, "logo_path": p["logo_path"]})
    return providers


def discover_movies(
    genre_ids: list[int],
    vote_average_gte: float = 6.5,
    vote_count_gte: int = 150,
    vote_count_lte: int | None = None,
    page: int = 1,
) -> list[dict]:
    """Query TMDB Discover for films matching the given genre and quality filters."""
    params: dict = {
        "sort_by": "vote_average.desc",
        "vote_average.gte": vote_average_gte,
        "vote_count.gte": vote_count_gte,
        "with_genres": ",".join(str(g) for g in genre_ids),
        "page": page,
    }
    if vote_count_lte is not None:
        params["vote_count.lte"] = vote_count_lte
    cache_key = "discover_" + "_".join(f"{k}-{v}" for k, v in sorted(params.items()))
    return _cached_get(cache_key, "/discover/movie", params).get("results", [])


def discover_popular_movies(year: int, page: int = 1, vote_count_gte: int = 1000) -> list[dict]:
    """Query TMDB Discover for well-known movies released in a given year.

    Sorted by vote_count, not TMDB's `popularity` score — popularity is a
    decaying live-trending metric (see the curated-pool rationale in
    six_degrees.py) and would silently exclude real, widely-seen movies whose
    current trending score happens to be low (e.g. This Is 40: vote_count
    2356, popularity 2.65). vote_count is a stable, monotonic fame signal.

    Uncached (see _cached_get) since results shift over time as vote counts
    grow — a cached page would never surface movies that cross the bar later.
    """
    params: dict = {
        "sort_by": "vote_count.desc",
        "primary_release_year": year,
        "vote_count.gte": vote_count_gte,
        "page": page,
    }
    cache_key = f"discover_popular_{year}_{vote_count_gte}_p{page}"
    return _cached_get(cache_key, "/discover/movie", params, use_cache=False).get("results", [])


def enrich_movie(title: str, year: int | None = None) -> dict | None:
    """Search for a movie and return its full enriched metadata."""
    match = search_movie(title, year)
    if not match:
        return None
    return get_movie_details(match["id"])
