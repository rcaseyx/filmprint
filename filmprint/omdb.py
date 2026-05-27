"""OMDB API client — RT, Metacritic, and IMDB scores by IMDB ID."""

import os
import requests

BASE_URL = "https://www.omdbapi.com"

# In-process cache — avoids a DB round-trip per movie on every rank_watchlist call.
_score_cache: dict[str, dict] = {}


def prime_score_cache(imdb_ids: list[str]) -> None:
    """Batch-fetch OMDB scores from the DB and populate the in-process cache.

    Call this once after loading a candidate list so subsequent get_scores()
    calls are served from memory instead of hitting the DB per movie.
    """
    from filmprint.db import batch_get_omdb_scores
    missing = [iid for iid in imdb_ids if iid and iid not in _score_cache]
    if not missing:
        return
    fetched = batch_get_omdb_scores(missing)
    _score_cache.update(fetched)


def get_scores(imdb_id: str) -> dict:
    """Return critic scores for a film by IMDB ID.

    Checks the in-process cache, then the DB, then the OMDB API.
    Returns a dict with keys: imdb, rt, metacritic (any may be None).
    """
    if not imdb_id:
        return {"imdb": None, "rt": None, "metacritic": None}

    if imdb_id in _score_cache:
        return _score_cache[imdb_id]

    from filmprint.db import get_movie_omdb_scores, save_movie_omdb_scores

    cached = get_movie_omdb_scores(imdb_id)
    if cached is not None:
        _score_cache[imdb_id] = cached
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
        save_movie_omdb_scores(imdb_id, None, None, None)
        empty = {"imdb": None, "rt": None, "metacritic": None}
        _score_cache[imdb_id] = empty
        return empty

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

    save_movie_omdb_scores(imdb_id, result["imdb"], result["rt"], result["metacritic"])
    _score_cache[imdb_id] = result
    return result
