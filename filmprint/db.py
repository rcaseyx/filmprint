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

import hashlib
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "filmprint.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate_users_nullable_username(conn: sqlite3.Connection) -> None:
    """Make letterboxd_username nullable and email unique (one-time migration)."""
    cols = {row["name"]: row["notnull"]
            for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if not cols.get("letterboxd_username", 0):
        return  # Already nullable
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("""
        CREATE TABLE users_new (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            email               TEXT UNIQUE,
            letterboxd_username TEXT UNIQUE,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        INSERT OR IGNORE INTO users_new (id, email, letterboxd_username, created_at)
        SELECT id, email, letterboxd_username, created_at FROM users
    """)
    conn.execute("DROP TABLE users")
    conn.execute("ALTER TABLE users_new RENAME TO users")
    conn.execute("PRAGMA foreign_keys = ON")


def init_db(seed_data: dict | None = None) -> None:
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                email               TEXT UNIQUE,
                letterboxd_username TEXT UNIQUE,
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

            CREATE TABLE IF NOT EXISTS keyword_themes (
                keyword    TEXT PRIMARY KEY,
                theme      TEXT NOT NULL,
                source     TEXT NOT NULL DEFAULT 'auto',  -- seed | auto | claude
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        """)
        _migrate_users_nullable_username(conn)
        if seed_data:
            for theme, keywords in seed_data.items():
                for kw in keywords:
                    conn.execute(
                        "INSERT OR IGNORE INTO keyword_themes (keyword, theme, source) VALUES (?, ?, 'seed')",
                        (kw, theme),
                    )
        # Migrations: add columns if not present
        for migration in [
            "ALTER TABLE taste_profile ADD COLUMN version TEXT NOT NULL DEFAULT '1.0'",
            "ALTER TABLE taste_profile ADD COLUMN clusters TEXT",
            "ALTER TABLE taste_profile ADD COLUMN ratings_hash TEXT",
            "ALTER TABLE recommendations ADD COLUMN outcome TEXT",
            "ALTER TABLE recommendations ADD COLUMN resolved_at TEXT",
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


def get_all_users_with_stats() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT u.id, u.email, u.letterboxd_username, u.created_at,
                   COUNT(DISTINCT r.movie_id) AS ratings_count,
                   COUNT(DISTINCT w.movie_id) AS watchlist_count
            FROM users u
            LEFT JOIN user_ratings r ON r.user_id = u.id
            LEFT JOIN user_watchlist w ON w.user_id = u.id
            GROUP BY u.id
            ORDER BY u.created_at DESC
        """).fetchall()
        return [dict(row) for row in rows]


def delete_user(user_id: int) -> None:
    with get_connection() as conn:
        for table in ("recommendations", "user_ratings", "user_watchlist", "user_watched", "taste_profile"):
            conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


# --- keyword_themes ---

def get_all_keyword_themes() -> dict[str, str]:
    """Return {keyword: theme} for all known keywords."""
    with get_connection() as conn:
        rows = conn.execute("SELECT keyword, theme FROM keyword_themes").fetchall()
        return {row["keyword"]: row["theme"] for row in rows}


def upsert_keyword_theme(keyword: str, theme: str, source: str = "auto") -> None:
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO keyword_themes (keyword, theme, source)
               VALUES (?, ?, ?)
               ON CONFLICT(keyword) DO UPDATE SET theme = excluded.theme, source = excluded.source""",
            (keyword, theme, source),
        )


def get_all_keyword_themes_full() -> list[dict]:
    """Return full rows for admin display."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT keyword, theme, source, created_at FROM keyword_themes ORDER BY theme, keyword"
        ).fetchall()
        return [dict(row) for row in rows]


def get_or_create_user_by_email(email: str) -> tuple[int, str | None]:
    """Return (user_id, letterboxd_username). Creates the user row if new."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, letterboxd_username FROM users WHERE email = ?", (email,)
        ).fetchone()
        if row:
            return row["id"], row["letterboxd_username"]
        cur = conn.execute("INSERT INTO users (email) VALUES (?)", (email,))
        return cur.lastrowid, None


def update_user_username(user_id: int, username: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET letterboxd_username = ? WHERE id = ?", (username, user_id)
        )


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
                rated_at          = COALESCE(excluded.rated_at, user_ratings.rated_at),
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

def compute_ratings_hash(user_id: int) -> str:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT movie_id, letterboxd_rating FROM user_ratings WHERE user_id = ? ORDER BY movie_id",
            (user_id,),
        ).fetchall()
    h = hashlib.sha256()
    for row in rows:
        h.update(f"{row['movie_id']}:{row['letterboxd_rating']}".encode())
    return h.hexdigest()


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
            "ratings_hash": row["ratings_hash"],
        }


def save_taste_profile(
    user_id: int,
    vector: list[float],
    ratings_count: int,
    version: str = "1.0",
    clusters: list[list[float]] | None = None,
) -> None:
    ratings_hash = compute_ratings_hash(user_id)
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO taste_profile (user_id, vector, ratings_count, version, clusters, ratings_hash)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                vector        = excluded.vector,
                built_at      = datetime('now'),
                ratings_count = excluded.ratings_count,
                version       = excluded.version,
                clusters      = excluded.clusters,
                ratings_hash  = excluded.ratings_hash
        """, (user_id, json.dumps(vector), ratings_count, version,
              json.dumps(clusters) if clusters is not None else None, ratings_hash))


def is_profile_stale(user_id: int, current_version: str = "1.0") -> bool:
    """Returns True if any rating value changed, ratings were added/removed, or the algorithm version changed."""
    profile = get_taste_profile(user_id)
    if not profile:
        return True
    if profile["version"] != current_version:
        return True
    return compute_ratings_hash(user_id) != profile["ratings_hash"]


# --- recommendations ---

def get_recent_ratings(user_id: int, limit: int = 20) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT r.letterboxd_rating, r.rated_at,
                   m.id, m.title, m.year, m.genres, m.runtime, m.raw_tmdb
            FROM user_ratings r
            JOIN movies m ON m.id = r.movie_id
            WHERE r.user_id = ?
            ORDER BY r.rated_at DESC
            LIMIT ?
        """, (user_id, limit)).fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        result.append(m)
    return result


def get_recommendation_history(user_id: int, limit: int = 20) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT rec.id, rec.recommended_at, rec.mood_context, rec.score,
                   m.id as movie_id, m.title, m.year, m.genres, m.runtime, m.raw_tmdb,
                   CASE WHEN r.movie_id IS NOT NULL THEN 1 ELSE 0 END as followed_through,
                   r.letterboxd_rating as follow_up_rating
            FROM recommendations rec
            JOIN movies m ON m.id = rec.movie_id
            LEFT JOIN user_ratings r
                   ON r.user_id = rec.user_id AND r.movie_id = rec.movie_id
            WHERE rec.user_id = ?
            ORDER BY rec.recommended_at DESC
            LIMIT ?
        """, (user_id, limit)).fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        m["mood_context"] = json.loads(m["mood_context"]) if m["mood_context"] else {}
        result.append(m)
    return result


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


def resolve_recommendation_outcomes(user_id: int) -> None:
    """Cross-reference unresolved recommendations against ratings and watched entries.

    Outcomes:
      enjoyed      — rated >= 3.5 (strong positive validation)
      disliked     — rated <= 2.5 (strong negative signal)
      rated_neutral— rated between 2.5 and 3.5 (watched, mild signal)
      watched      — in user_watched but no rating yet
    """
    with get_connection() as conn:
        # Resolve via ratings first
        conn.execute("""
            UPDATE recommendations
            SET outcome = CASE
                WHEN (SELECT letterboxd_rating FROM user_ratings
                      WHERE user_id = ? AND movie_id = recommendations.movie_id) >= 3.5
                    THEN 'enjoyed'
                WHEN (SELECT letterboxd_rating FROM user_ratings
                      WHERE user_id = ? AND movie_id = recommendations.movie_id) <= 2.5
                    THEN 'disliked'
                ELSE 'rated_neutral'
            END,
            resolved_at = datetime('now')
            WHERE user_id = ?
              AND outcome IS NULL
              AND movie_id IN (SELECT movie_id FROM user_ratings WHERE user_id = ?)
        """, (user_id, user_id, user_id, user_id))

        # Resolve remaining via watched (no rating yet)
        conn.execute("""
            UPDATE recommendations
            SET outcome = 'watched', resolved_at = datetime('now')
            WHERE user_id = ?
              AND outcome IS NULL
              AND movie_id IN (SELECT movie_id FROM user_watched WHERE user_id = ?)
        """, (user_id, user_id))


def get_recommendation_boosts(user_id: int) -> dict[int, float]:
    """Return {movie_id: weight_multiplier} for recommendations with confirmed outcomes.

    Only enjoyed and disliked outcomes get a boost — both get 1.5x so the profile
    pulls more strongly toward validated wins and away from confirmed misses.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT movie_id, outcome FROM recommendations
            WHERE user_id = ? AND outcome IN ('enjoyed', 'disliked')
        """, (user_id,)).fetchall()
    return {row["movie_id"]: 1.5 for row in rows}
