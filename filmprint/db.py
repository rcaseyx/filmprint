"""
Database layer — SQLite now, designed to port to Postgres.

SQLite → Postgres migration notes:
  - Replace sqlite3 with psycopg2 or asyncpg
  - INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL PRIMARY KEY
  - TEXT (used for JSON) → JSONB
  - PRAGMA foreign_keys = ON → Postgres enforces FKs by default
  - datetime('now') → NOW()
  - get_connection(): swap DB_PATH for a connection string
"""

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "filmprint.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                email               TEXT,
                letterboxd_username TEXT NOT NULL UNIQUE,
                created_at          TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS movies (
                id              INTEGER PRIMARY KEY,  -- TMDB id
                title           TEXT NOT NULL,
                year            INTEGER,
                runtime         INTEGER,
                genres          TEXT,                 -- JSON array of genre names
                vote_average    REAL,
                vote_count      INTEGER,
                popularity      REAL,
                origin_country  TEXT,
                language        TEXT,
                keywords        TEXT,                 -- JSON array of keyword names
                director        TEXT,
                cast            TEXT,                 -- JSON array of top-billed names
                raw_tmdb        TEXT,                 -- full TMDB response, for rebuilding vectors
                feature_vector  TEXT,                 -- JSON array of floats
                last_fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS user_ratings (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id           INTEGER NOT NULL REFERENCES users(id),
                movie_id          INTEGER NOT NULL REFERENCES movies(id),
                letterboxd_rating REAL NOT NULL,
                rated_at          TEXT,
                source            TEXT NOT NULL DEFAULT 'csv',  -- csv | rss
                UNIQUE(user_id, movie_id)
            );

            CREATE TABLE IF NOT EXISTS user_watchlist (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                movie_id    INTEGER NOT NULL REFERENCES movies(id),
                added_at    TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, movie_id)
            );

            CREATE TABLE IF NOT EXISTS user_watched (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                movie_id    INTEGER NOT NULL REFERENCES movies(id),
                watched_at  TEXT,
                source      TEXT NOT NULL DEFAULT 'csv',  -- csv | rss
                UNIQUE(user_id, movie_id)
            );

            CREATE TABLE IF NOT EXISTS taste_profile (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
                vector        TEXT NOT NULL,  -- JSON array of floats
                built_at      TEXT NOT NULL DEFAULT (datetime('now')),
                ratings_count INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recommendations (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER NOT NULL REFERENCES users(id),
                movie_id        INTEGER NOT NULL REFERENCES movies(id),
                recommended_at  TEXT NOT NULL DEFAULT (datetime('now')),
                mood_context    TEXT,   -- JSON object of mood answers
                score           REAL
            );
        """)
        # Migrations: add columns if not present
        for migration in [
            "ALTER TABLE taste_profile ADD COLUMN version TEXT NOT NULL DEFAULT '1.0'",
            "ALTER TABLE taste_profile ADD COLUMN clusters TEXT",
        ]:
            try:
                conn.execute(migration)
            except Exception:
                pass


# --- users ---

def get_all_users() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM users").fetchall()
        return [dict(row) for row in rows]


def get_or_create_user(username: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE letterboxd_username = ?", (username,)
        ).fetchone()
        if row:
            return row["id"]
        cur = conn.execute(
            "INSERT INTO users (letterboxd_username) VALUES (?)", (username,)
        )
        return cur.lastrowid


def get_or_prompt_user() -> tuple[int, str]:
    """Return (user_id, username). Prompts for username on first run if no users exist."""
    users = get_all_users()
    if users:
        user = users[0]
        return user["id"], user["letterboxd_username"]
    print("\nNo user found. Let's get you set up.")
    username = input("Enter your Letterboxd username: ").strip()
    user_id = get_or_create_user(username)
    return user_id, username


# --- movies ---

def get_movie(tmdb_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM movies WHERE id = ?", (tmdb_id,)).fetchone()
        if not row:
            return None
        movie = dict(row)
        movie["feature_vector"] = json.loads(movie["feature_vector"]) if movie["feature_vector"] else None
        movie["raw_tmdb"] = json.loads(movie["raw_tmdb"]) if movie["raw_tmdb"] else None
        return movie


def upsert_movie(tmdb_data: dict, feature_vector: list[float] | None = None) -> None:
    crew = tmdb_data.get("credits", {}).get("crew", [])
    directors = [p["name"] for p in crew if p.get("job") == "Director"]
    cast = [p["name"] for p in tmdb_data.get("credits", {}).get("cast", [])[:10]]
    genres = [g["name"] for g in tmdb_data.get("genres", [])]
    keywords = [k["name"] for k in tmdb_data.get("keywords", {}).get("keywords", [])]
    countries = tmdb_data.get("production_countries", [])
    release = tmdb_data.get("release_date", "") or ""

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO movies (
                id, title, year, runtime, genres, vote_average, vote_count,
                popularity, origin_country, language, keywords, director, cast,
                raw_tmdb, feature_vector, last_fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                title           = excluded.title,
                year            = excluded.year,
                runtime         = excluded.runtime,
                genres          = excluded.genres,
                vote_average    = excluded.vote_average,
                vote_count      = excluded.vote_count,
                popularity      = excluded.popularity,
                origin_country  = excluded.origin_country,
                language        = excluded.language,
                keywords        = excluded.keywords,
                director        = excluded.director,
                cast            = excluded.cast,
                raw_tmdb        = excluded.raw_tmdb,
                feature_vector  = COALESCE(excluded.feature_vector, movies.feature_vector),
                last_fetched_at = datetime('now')
        """, (
            tmdb_data["id"],
            tmdb_data.get("title", ""),
            int(release[:4]) if len(release) >= 4 else None,
            tmdb_data.get("runtime"),
            json.dumps(genres),
            tmdb_data.get("vote_average"),
            tmdb_data.get("vote_count"),
            tmdb_data.get("popularity"),
            countries[0]["iso_3166_1"] if countries else None,
            tmdb_data.get("original_language"),
            json.dumps(keywords),
            json.dumps(directors),
            json.dumps(cast),
            json.dumps(tmdb_data),
            json.dumps(feature_vector) if feature_vector is not None else None,
        ))


def update_feature_vector(tmdb_id: int, vector: list[float]) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE movies SET feature_vector = ? WHERE id = ?",
            (json.dumps(vector), tmdb_id),
        )


def get_all_movies_with_vectors() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM movies WHERE feature_vector IS NOT NULL"
        ).fetchall()
    movies = []
    for row in rows:
        m = dict(row)
        m["feature_vector"] = json.loads(m["feature_vector"])
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        movies.append(m)
    return movies


# --- user_ratings ---

def upsert_rating(user_id: int, movie_id: int, rating: float, rated_at: str | None, source: str = "csv") -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO user_ratings (user_id, movie_id, letterboxd_rating, rated_at, source)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                letterboxd_rating = excluded.letterboxd_rating,
                rated_at          = excluded.rated_at,
                source            = excluded.source
        """, (user_id, movie_id, rating, rated_at, source))


def get_user_ratings(user_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT r.letterboxd_rating, r.rated_at, m.*
            FROM user_ratings r
            JOIN movies m ON m.id = r.movie_id
            WHERE r.user_id = ?
        """, (user_id,)).fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["feature_vector"] = json.loads(m["feature_vector"]) if m["feature_vector"] else None
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        result.append(m)
    return result


def get_ratings_count(user_id: int) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as count FROM user_ratings WHERE user_id = ?", (user_id,)
        ).fetchone()
        return row["count"]


# --- user_watchlist ---

def upsert_watchlist_entry(user_id: int, movie_id: int) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO user_watchlist (user_id, movie_id) VALUES (?, ?)
        """, (user_id, movie_id))


def get_user_watchlist(user_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT m.*
            FROM user_watchlist w
            JOIN movies m ON m.id = w.movie_id
            WHERE w.user_id = ?
        """, (user_id,)).fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["feature_vector"] = json.loads(m["feature_vector"]) if m["feature_vector"] else None
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        result.append(m)
    return result


# --- user_watched ---

def upsert_watched(user_id: int, movie_id: int, watched_at: str | None, source: str = "csv") -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO user_watched (user_id, movie_id, watched_at, source)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                watched_at = excluded.watched_at,
                source     = excluded.source
        """, (user_id, movie_id, watched_at, source))


def get_seen_movie_ids(user_id: int) -> set[int]:
    """Return all TMDB IDs the user has rated or watched — used to filter candidates."""
    with get_connection() as conn:
        rated = conn.execute(
            "SELECT movie_id FROM user_ratings WHERE user_id = ?", (user_id,)
        ).fetchall()
        watched = conn.execute(
            "SELECT movie_id FROM user_watched WHERE user_id = ?", (user_id,)
        ).fetchall()
    return {row["movie_id"] for row in rated + watched}


# --- taste_profile ---

def get_taste_profile(user_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM taste_profile WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not row:
            return None
        return {
            "vector": json.loads(row["vector"]),
            "ratings_count": row["ratings_count"],
            "version": row["version"],
            "clusters": json.loads(row["clusters"]) if row["clusters"] else [],
        }


def save_taste_profile(
    user_id: int,
    vector: list[float],
    ratings_count: int,
    version: str = "1.0",
    clusters: list[list[float]] | None = None,
) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO taste_profile (user_id, vector, ratings_count, version, clusters)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                vector        = excluded.vector,
                built_at      = datetime('now'),
                ratings_count = excluded.ratings_count,
                version       = excluded.version,
                clusters      = excluded.clusters
        """, (user_id, json.dumps(vector), ratings_count, version,
              json.dumps(clusters) if clusters is not None else None))


def is_profile_stale(user_id: int, current_version: str = "1.0") -> bool:
    """Returns True if ratings have changed or the profile algorithm version changed."""
    current_count = get_ratings_count(user_id)
    profile = get_taste_profile(user_id)
    if not profile:
        return True
    return current_count != profile["ratings_count"] or profile["version"] != current_version


# --- recommendations ---

def log_recommendation(user_id: int, movie_id: int, score: float, mood_context: dict) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO recommendations (user_id, movie_id, score, mood_context)
            VALUES (?, ?, ?, ?)
        """, (user_id, movie_id, score, json.dumps(mood_context)))


def get_recent_recommendation_ids(user_id: int, days: int = 14) -> set[int]:
    """Return movie IDs recommended to this user in the last N days."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT DISTINCT movie_id FROM recommendations
            WHERE user_id = ?
              AND recommended_at >= datetime('now', ? || ' days')
        """, (user_id, f"-{days}")).fetchall()
    return {row["movie_id"] for row in rows}
