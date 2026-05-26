"""OMDB API client — RT, Metacritic, and IMDB scores by IMDB ID."""

import os
import requests

BASE_URL = "https://www.omdbapi.com"


def get_scores(imdb_id: str) -> dict:
    """Return critic scores for a film by IMDB ID.

    Returns a dict with keys: imdb, rt, metacritic (any may be None).
    Results are cached to the DB.
    """
    if not imdb_id:
        return {"imdb": None, "rt": None, "metacritic": None}

    from filmprint.db import get_api_cache, set_api_cache
    cache_key = f"omdb_{imdb_id}"
    cached = get_api_cache(cache_key)
    if cached is not None:
        return cached

    try:
        resp = requests.get(
            BASE_URL,
            params={"i": imdb_id, "apikey": os.environ["OMDB_API_KEY"]},
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return {"imdb": None, "rt": None, "metacritic": None}

    if data.get("Response") == "False":
        return {"imdb": None, "rt": None, "metacritic": None}

    rt = next(
        (r["Value"] for r in data.get("Ratings", []) if r["Source"] == "Rotten Tomatoes"),
        None,
    )
    result = {
        "imdb": data.get("imdbRating") or None,
        "rt": rt,
        "metacritic": data.get("Metascore") or None,
    }
    result = {k: (None if v in (None, "N/A") else v) for k, v in result.items()}

    set_api_cache(cache_key, result)
    return result
