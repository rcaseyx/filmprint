"""Shared fixtures for filmprint tests."""

import pytest


def make_movie(
    tmdb_id: int = 1,
    title: str = "Test Film",
    year: int = 2015,
    genres: list[str] | None = None,
    runtime: int = 95,
    vote_average: float = 7.5,
    popularity: float = 42.0,
    keywords: list[str] | None = None,
    director: str = "Jane Doe",
    cast: list[str] | None = None,
) -> dict:
    """Build a minimal movie dict that mirrors the shape coming out of the DB."""
    genres = genres or ["Drama"]
    keywords = keywords or []
    cast = cast or ["Actor One", "Actor Two"]
    release_date = f"{year}-06-15"

    raw_tmdb = {
        "id": tmdb_id,
        "title": title,
        "release_date": release_date,
        "runtime": runtime,
        "vote_average": vote_average,
        "popularity": popularity,
        "genres": [{"id": i, "name": g} for i, g in enumerate(genres)],
        "keywords": {"keywords": [{"id": i, "name": kw} for i, kw in enumerate(keywords)]},
        "credits": {
            "crew": [{"name": director, "job": "Director"}],
            "cast": [{"name": a} for a in cast],
        },
        "production_countries": [{"iso_3166_1": "US"}],
        "original_language": "en",
    }
    return {
        "id": tmdb_id,
        "title": title,
        "year": year,
        "runtime": runtime,
        "vote_average": vote_average,
        "popularity": popularity,
        "raw_tmdb": raw_tmdb,
        "feature_vector": None,
    }
