"""TMDB API client — movie search and metadata enrichment."""

import os
import requests

BASE_URL = "https://api.themoviedb.org/3"


def _get(endpoint: str, params: dict = {}) -> dict:
    params["api_key"] = os.environ["TMDB_API_KEY"]
    response = requests.get(f"{BASE_URL}{endpoint}", params=params)
    response.raise_for_status()
    return response.json()


def search_movie(title: str, year: int | None = None) -> dict | None:
    """Search for a movie by title and optional year, return best match."""
    params = {"query": title, "include_adult": False}
    if year:
        params["year"] = year
    results = _get("/search/movie", params).get("results", [])
    return results[0] if results else None


def get_movie_details(tmdb_id: int) -> dict:
    """Fetch full movie details including genres and keywords."""
    details = _get(f"/movie/{tmdb_id}", {"append_to_response": "keywords,credits"})
    return details


def enrich_movie(title: str, year: int | None = None) -> dict | None:
    """Search for a movie and return its full enriched metadata."""
    match = search_movie(title, year)
    if not match:
        return None
    return get_movie_details(match["id"])
