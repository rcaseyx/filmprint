"""OMDB API client — RT, Metacritic, and IMDB scores by IMDB ID."""

import json
import os
import requests
from pathlib import Path

BASE_URL = "https://www.omdbapi.com"
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"


def get_scores(imdb_id: str) -> dict:
    """Return critic scores for a film by IMDB ID.

    Returns a dict with keys: imdb, rt, metacritic (any may be None).
    Results are cached to disk.
    """
    if not imdb_id:
        return {"imdb": None, "rt": None, "metacritic": None}

    cache_path = CACHE_DIR / f"omdb_{imdb_id}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

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

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(result))
    return result
