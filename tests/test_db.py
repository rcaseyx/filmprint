"""Tests for filmprint/db.py — uses a temp SQLite file, no real DB touched."""

import pytest
import filmprint.db as db_module
from filmprint.db import (
    get_connection,
    get_seen_movie_ids,
    get_user_ratings,
    init_db,
    is_profile_stale,
    upsert_movie,
    upsert_rating,
    upsert_watchlist_entry,
    get_or_create_user_by_email,
)


def get_or_create_user(username: str) -> int:
    """Test helper: create a user by username (via fake email)."""
    user_id, _ = get_or_create_user_by_email(f"{username}@test.local")
    return user_id
from tests.conftest import make_movie


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Redirect DB_PATH to a temp file for each test."""
    monkeypatch.setattr(db_module, "DB_PATH", tmp_path / "test.db")
    init_db()


def _tmdb_data(movie: dict) -> dict:
    """Extract raw_tmdb dict and add required top-level id."""
    raw = movie["raw_tmdb"]
    raw["id"] = movie["id"]
    return raw


# --- init_db ---

def test_init_db_creates_tables():
    with get_connection() as conn:
        tables = {row["name"] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
    assert {"users", "movies", "user_ratings", "user_watchlist", "taste_profile", "recommendations"} <= tables


# --- upsert_movie ---

def test_upsert_movie_inserts():
    movie = make_movie(tmdb_id=42, title="Parasite")
    upsert_movie(_tmdb_data(movie))
    with get_connection() as conn:
        row = conn.execute("SELECT title FROM movies WHERE id = 42").fetchone()
    assert row["title"] == "Parasite"


def test_upsert_movie_is_idempotent():
    movie = make_movie(tmdb_id=42, title="Parasite")
    upsert_movie(_tmdb_data(movie))
    upsert_movie(_tmdb_data(movie))
    with get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) as n FROM movies WHERE id = 42").fetchone()["n"]
    assert count == 1


def test_upsert_movie_updates_title():
    movie = make_movie(tmdb_id=42, title="Old Title")
    upsert_movie(_tmdb_data(movie))
    updated = make_movie(tmdb_id=42, title="New Title")
    upsert_movie(_tmdb_data(updated))
    with get_connection() as conn:
        row = conn.execute("SELECT title FROM movies WHERE id = 42").fetchone()
    assert row["title"] == "New Title"


# --- upsert_rating + get_user_ratings ---

def test_upsert_and_retrieve_rating():
    movie = make_movie(tmdb_id=1)
    upsert_movie(_tmdb_data(movie))
    user_id = get_or_create_user("testuser")
    upsert_rating(user_id, 1, 4.5, "2024-01-01")
    ratings = get_user_ratings(user_id)
    assert len(ratings) == 1
    assert ratings[0]["letterboxd_rating"] == 4.5


def test_upsert_rating_updates_on_conflict():
    movie = make_movie(tmdb_id=1)
    upsert_movie(_tmdb_data(movie))
    user_id = get_or_create_user("testuser")
    upsert_rating(user_id, 1, 3.0, "2024-01-01")
    upsert_rating(user_id, 1, 5.0, "2024-01-02")
    ratings = get_user_ratings(user_id)
    assert len(ratings) == 1
    assert ratings[0]["letterboxd_rating"] == 5.0


# --- get_seen_movie_ids ---

def test_get_seen_movie_ids_includes_rated():
    movie = make_movie(tmdb_id=7)
    upsert_movie(_tmdb_data(movie))
    user_id = get_or_create_user("testuser")
    upsert_rating(user_id, 7, 4.0, "2024-01-01")
    assert 7 in get_seen_movie_ids(user_id)


def test_get_seen_movie_ids_includes_watchlisted_only_if_rated():
    movie = make_movie(tmdb_id=8)
    upsert_movie(_tmdb_data(movie))
    user_id = get_or_create_user("testuser")
    upsert_watchlist_entry(user_id, 8)
    # Watchlist-only should NOT appear in seen_ids
    assert 8 not in get_seen_movie_ids(user_id)


def test_get_seen_movie_ids_empty_for_new_user():
    user_id = get_or_create_user("newuser")
    assert get_seen_movie_ids(user_id) == set()


# --- is_profile_stale ---

def test_is_profile_stale_no_profile():
    user_id = get_or_create_user("testuser")
    assert is_profile_stale(user_id) is True


def test_is_profile_stale_false_after_save():
    from filmprint.db import save_taste_profile
    user_id = get_or_create_user("testuser")
    save_taste_profile(user_id, [0.1, 0.2], ratings_count=0, version="1.0")
    # No ratings, so hash is stable — profile should not be stale
    assert is_profile_stale(user_id, current_version="1.0") is False


def test_is_profile_stale_version_mismatch():
    from filmprint.db import save_taste_profile
    user_id = get_or_create_user("testuser")
    save_taste_profile(user_id, [0.1], ratings_count=0, version="1.0")
    assert is_profile_stale(user_id, current_version="2.0") is True
