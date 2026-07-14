"""Shared fixtures for filmprint tests."""

import os
from urllib.parse import urlparse

import pytest


def require_disposable_test_database() -> None:
    """Refuse to proceed unless DATABASE_URL clearly points at a disposable test
    database. Call this as the first line of any fixture/test that runs
    destructive statements (TRUNCATE, DROP, DELETE without a WHERE, etc.).

    On 2026-07-14, tests/test_db.py's autouse `isolated_db` fixture ran
    `TRUNCATE ... CASCADE` against the live production database because
    DATABASE_URL was sourced from `.env`, which points at production -- there
    was no separate test database configured at all. That wiped movies, users,
    ratings, watchlists, keyword themes, and trivia content in production with
    no viable recent backup. See /Users/rcaseyx/projects/filmprint-data-recovery-plan.md.

    The check: the database host or database name must contain "test" or "ci"
    (case-insensitive). Production is a plain Railway Postgres proxy host with
    dbname "railway" -- it will never match this by accident. A real test
    database must be named to make its purpose unambiguous, not merely assumed
    from context.
    """
    url = os.environ.get("DATABASE_URL", "")
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    dbname = (parsed.path or "").lstrip("/").lower()
    if not url or not any("test" in s or "ci" in s for s in (host, dbname)):
        pytest.fail(
            "\n\nRefusing to run: DATABASE_URL does not look like a disposable "
            "test database (expected 'test' or 'ci' in the host or database "
            f"name; got host={host!r} dbname={dbname!r}).\n"
            "This check exists because a destructive TRUNCATE ... CASCADE fixture "
            "wiped the filmprint production database on 2026-07-14 when tests ran "
            "against the production DATABASE_URL. Point DATABASE_URL at a disposable "
            "test Postgres instance before running this test file. See "
            "/Users/rcaseyx/projects/filmprint-data-recovery-plan.md for the incident "
            "and recovery plan.\n",
            pytrace=False,
        )


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
            "cast": [{"id": i, "name": a, "character": f"Character {i}", "order": i} for i, a in enumerate(cast)],
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
