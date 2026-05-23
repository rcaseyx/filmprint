"""TMDB API client — movie search and metadata enrichment."""

import json
import os
import requests
from pathlib import Path

BASE_URL = "https://api.themoviedb.org/3"
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _cached_get(cache_key: str, endpoint: str, params: dict = {}) -> dict:
    """Fetch from cache if available, otherwise hit the API and cache the result."""
    path = _cache_path(cache_key)
    if path.exists():
        return json.loads(path.read_text())

    params = {**params, "api_key": os.environ["TMDB_API_KEY"]}
    response = requests.get(f"{BASE_URL}{endpoint}", params=params)
    response.raise_for_status()
    data = response.json()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
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


def get_watch_providers(tmdb_id: int, country: str = "US") -> list[dict]:
    """Return flatrate (streaming) providers for a film in the given country."""
    data = _cached_get(f"providers_{tmdb_id}", f"/movie/{tmdb_id}/watch/providers")
    region = data.get("results", {}).get(country, {})
    return [
        {"name": p["provider_name"], "logo_path": p["logo_path"]}
        for p in region.get("flatrate", [])
    ]


def enrich_movie(title: str, year: int | None = None) -> dict | None:
    """Search for a movie and return its full enriched metadata."""
    match = search_movie(title, year)
    if not match:
        return None
    return get_movie_details(match["id"])
