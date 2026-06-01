"""
Database layer — PostgreSQL via psycopg2.

Requires DATABASE_URL environment variable (standard Postgres connection string).
JSON columns are stored as TEXT and serialized/deserialized in application code.
"""

import hashlib
import json
import os
import threading
from contextlib import contextmanager

import bcrypt
import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

_pool: ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    2, 20,
                    os.environ["DATABASE_URL"],
                    cursor_factory=psycopg2.extras.RealDictCursor,
                )
    return _pool


@contextmanager
def get_connection():
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        pool.putconn(conn)


def close_db() -> None:
    """Close all connections in the pool. Call before process exit in short-lived scripts."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


def init_db(seed_data: dict | None = None) -> None:
    ddl = [
        """CREATE TABLE IF NOT EXISTS users (
            id                  BIGSERIAL PRIMARY KEY,
            email               TEXT UNIQUE,
            letterboxd_username TEXT UNIQUE,
            password_hash       TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS movies (
            id              BIGINT PRIMARY KEY,
            title           TEXT NOT NULL,
            year            INTEGER,
            runtime         INTEGER,
            genres          TEXT,
            vote_average    REAL,
            vote_count      INTEGER,
            popularity      REAL,
            origin_country  TEXT,
            language        TEXT,
            keywords        TEXT,
            director        TEXT,
            "cast"          TEXT,
            raw_tmdb        TEXT,
            feature_vector  TEXT,
            last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS user_ratings (
            id                BIGSERIAL PRIMARY KEY,
            user_id           BIGINT NOT NULL REFERENCES users(id),
            movie_id          BIGINT NOT NULL REFERENCES movies(id),
            letterboxd_rating REAL NOT NULL,
            rated_at          TIMESTAMPTZ,
            source            TEXT NOT NULL DEFAULT 'csv',
            UNIQUE(user_id, movie_id)
        )""",
        """CREATE TABLE IF NOT EXISTS user_watchlist (
            id          BIGSERIAL PRIMARY KEY,
            user_id     BIGINT NOT NULL REFERENCES users(id),
            movie_id    BIGINT NOT NULL REFERENCES movies(id),
            added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, movie_id)
        )""",
        """CREATE TABLE IF NOT EXISTS user_watched (
            id          BIGSERIAL PRIMARY KEY,
            user_id     BIGINT NOT NULL REFERENCES users(id),
            movie_id    BIGINT NOT NULL REFERENCES movies(id),
            watched_at  TIMESTAMPTZ,
            source      TEXT NOT NULL DEFAULT 'csv',
            UNIQUE(user_id, movie_id)
        )""",
        """CREATE TABLE IF NOT EXISTS taste_profile (
            id            BIGSERIAL PRIMARY KEY,
            user_id       BIGINT NOT NULL UNIQUE REFERENCES users(id),
            vector        TEXT NOT NULL,
            built_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ratings_count INTEGER NOT NULL,
            version       TEXT NOT NULL DEFAULT '1.0',
            clusters      TEXT,
            ratings_hash  TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS recommendations (
            id              BIGSERIAL PRIMARY KEY,
            user_id         BIGINT NOT NULL REFERENCES users(id),
            movie_id        BIGINT NOT NULL REFERENCES movies(id),
            recommended_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            mood_context    TEXT,
            score           REAL,
            outcome         TEXT,
            resolved_at     TIMESTAMPTZ
        )""",
        """CREATE TABLE IF NOT EXISTS keyword_themes (
            keyword    TEXT PRIMARY KEY,
            theme      TEXT NOT NULL,
            source     TEXT NOT NULL DEFAULT 'auto',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS theme_centroids (
            theme      TEXT PRIMARY KEY,
            centroid   TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "ALTER TABLE movies ADD COLUMN IF NOT EXISTS imdb_id TEXT",
        "ALTER TABLE movies ADD COLUMN IF NOT EXISTS imdb_score TEXT",
        "ALTER TABLE movies ADD COLUMN IF NOT EXISTS rt_score TEXT",
        "ALTER TABLE movies ADD COLUMN IF NOT EXISTS mc_score TEXT",
        "ALTER TABLE movies ADD COLUMN IF NOT EXISTS omdb_fetched_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS idx_movies_imdb_id ON movies(imdb_id)",
        "CREATE INDEX IF NOT EXISTS idx_keyword_themes_theme ON keyword_themes(theme)",
        # Backfill imdb_id for existing rows from raw_tmdb JSON
        """UPDATE movies SET imdb_id = (raw_tmdb::jsonb)->>'imdb_id'
           WHERE imdb_id IS NULL AND raw_tmdb IS NOT NULL AND length(raw_tmdb) > 2""",
        """CREATE TABLE IF NOT EXISTS beta_whitelist (
            email           TEXT PRIMARY KEY,
            added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "ALTER TABLE beta_whitelist ADD COLUMN IF NOT EXISTS approved_until TIMESTAMPTZ",
        """CREATE TABLE IF NOT EXISTS beta_requests (
            id                  BIGSERIAL PRIMARY KEY,
            name                TEXT NOT NULL,
            email               TEXT NOT NULL UNIQUE,
            letterboxd_username TEXT NOT NULL,
            ratings_count       INTEGER,
            watchlist_count     INTEGER,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
    ]
    with get_connection() as conn:
        cur = conn.cursor()
        for stmt in ddl:
            cur.execute(stmt)
        if seed_data:
            for theme, keywords in seed_data.items():
                for kw in keywords:
                    cur.execute(
                        """INSERT INTO keyword_themes (keyword, theme, source)
                           VALUES (%s, %s, 'seed') ON CONFLICT DO NOTHING""",
                        (kw, theme),
                    )


# --- users ---

def get_user_by_id(user_id: int) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, email, letterboxd_username FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def get_user_by_email(email: str) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, letterboxd_username FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        return dict(row) if row else None


# --- beta whitelist ---

def is_whitelisted(email: str) -> bool:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM beta_whitelist WHERE email = lower(%s) AND (approved_until IS NULL OR approved_until > NOW())",
            (email,),
        )
        return cur.fetchone() is not None


def get_whitelist() -> list[str]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM beta_whitelist ORDER BY added_at")
        return [row["email"] for row in cur.fetchall()]


def add_to_whitelist(email: str, approved_until=None) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO beta_whitelist (email, approved_until)
               VALUES (lower(%s), %s)
               ON CONFLICT (email) DO UPDATE SET approved_until = EXCLUDED.approved_until""",
            (email, approved_until),
        )


def remove_from_whitelist(email: str) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM beta_whitelist WHERE email = lower(%s)", (email,))


# --- beta requests ---

def create_beta_request(name: str, email: str, letterboxd_username: str) -> int:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO beta_requests (name, email, letterboxd_username)
               VALUES (%s, lower(%s), %s)
               RETURNING id""",
            (name, email, letterboxd_username),
        )
        return cur.fetchone()["id"]


def get_beta_requests() -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM beta_requests ORDER BY created_at DESC")
        return [dict(row) for row in cur.fetchall()]


def get_beta_request(request_id: int) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM beta_requests WHERE id = %s", (request_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def update_beta_request_counts(request_id: int, ratings_count: int | None, watchlist_count: int | None) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE beta_requests SET ratings_count = %s, watchlist_count = %s WHERE id = %s",
            (ratings_count, watchlist_count, request_id),
        )


def delete_beta_request(request_id: int) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM beta_requests WHERE id = %s", (request_id,))


def get_all_users() -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users")
        return [dict(row) for row in cur.fetchall()]


def get_users_with_letterboxd() -> list[dict]:
    """Return all users that have a Letterboxd username set."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, letterboxd_username FROM users WHERE letterboxd_username IS NOT NULL"
        )
        return [dict(row) for row in cur.fetchall()]


def get_all_users_with_stats() -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT u.id, u.email, u.letterboxd_username, u.created_at,
                   (SELECT COUNT(*) FROM user_ratings WHERE user_id = u.id) AS ratings_count,
                   (SELECT COUNT(*) FROM user_watchlist WHERE user_id = u.id) AS watchlist_count
            FROM users u
            ORDER BY u.created_at DESC
        """)
        return [dict(row) for row in cur.fetchall()]


def delete_user(user_id: int) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        for table in ("recommendations", "user_ratings", "user_watchlist", "user_watched", "taste_profile"):
            cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


# --- keyword_themes ---

def get_all_keyword_themes() -> dict[str, str]:
    """Return {keyword: theme} for all known keywords."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT keyword, theme FROM keyword_themes")
        return {row["keyword"]: row["theme"] for row in cur.fetchall()}


def upsert_keyword_theme(keyword: str, theme: str, source: str = "auto") -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO keyword_themes (keyword, theme, source)
               VALUES (%s, %s, %s)
               ON CONFLICT(keyword) DO UPDATE SET theme = EXCLUDED.theme, source = EXCLUDED.source""",
            (keyword, theme, source),
        )


def get_all_keyword_themes_full() -> list[dict]:
    """Return full rows for admin display."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT keyword, theme, source, created_at FROM keyword_themes ORDER BY theme, keyword")
        return [dict(row) for row in cur.fetchall()]


def get_keyword_theme_stats() -> dict:
    """Aggregate keyword/theme counts in SQL — avoids fetching all rows."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                SUM(cnt)                              AS total_keywords,
                COUNT(*)                              AS total_themes,
                COUNT(*) FILTER (WHERE cnt > 1)       AS multi_keyword_themes
            FROM (SELECT theme, COUNT(*) AS cnt FROM keyword_themes GROUP BY theme) sub
        """)
        row = cur.fetchone()
        return {
            "total_keywords": int(row["total_keywords"] or 0),
            "total_themes":   int(row["total_themes"]   or 0),
            "multi_keyword_themes": int(row["multi_keyword_themes"] or 0),
        }


def save_theme_centroids(centroids: dict[str, list[float]]) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM theme_centroids")
        cur.executemany(
            "INSERT INTO theme_centroids (theme, centroid) VALUES (%s, %s)",
            [(theme, json.dumps(vec)) for theme, vec in centroids.items()],
        )


def load_theme_centroids() -> dict[str, list[float]]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT theme, centroid FROM theme_centroids")
        return {row["theme"]: json.loads(row["centroid"]) for row in cur.fetchall()}


def get_user_by_username(username: str) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, email, letterboxd_username FROM users WHERE letterboxd_username = %s",
            (username,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def search_users_by_username(q: str) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT u.id, u.letterboxd_username,
                      COUNT(DISTINCT r.movie_id) AS ratings_count
               FROM users u
               LEFT JOIN user_ratings r ON r.user_id = u.id
               WHERE u.letterboxd_username LIKE %s
               GROUP BY u.id
               ORDER BY u.letterboxd_username
               LIMIT 20""",
            (f"%{q}%",),
        )
        return [dict(row) for row in cur.fetchall()]


def get_or_create_user_by_email(email: str) -> tuple[int, str | None]:
    """Return (user_id, letterboxd_username). Creates the user row if new."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, letterboxd_username FROM users WHERE email = %s", (email,)
        )
        row = cur.fetchone()
        if row:
            return row["id"], row["letterboxd_username"]
        cur.execute("INSERT INTO users (email) VALUES (%s) RETURNING id", (email,))
        return cur.fetchone()["id"], None


def create_user_with_password(email: str, password: str) -> int:
    """Create a credentials-based user. Raises ValueError if email is taken."""
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    with get_connection() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                "INSERT INTO users (email, password_hash) VALUES (%s, %s) RETURNING id",
                (email, password_hash),
            )
            return cur.fetchone()["id"]
        except psycopg2.IntegrityError:
            raise ValueError("Email already registered")


def verify_user_password(email: str, password: str) -> tuple[int, str | None] | None:
    """Return (user_id, letterboxd_username) if credentials are valid, else None."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, letterboxd_username, password_hash FROM users WHERE email = %s", (email,)
        )
        row = cur.fetchone()
    if not row or not row["password_hash"]:
        return None
    if bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return row["id"], row["letterboxd_username"]
    return None


def update_user_username(user_id: int, username: str) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET letterboxd_username = %s WHERE id = %s", (username, user_id)
        )


# --- movies ---

def get_movie(tmdb_id: int) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM movies WHERE id = %s", (tmdb_id,))
        row = cur.fetchone()
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
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO movies (
                id, title, year, runtime, genres, vote_average, vote_count,
                popularity, origin_country, language, keywords, director, "cast",
                raw_tmdb, feature_vector, imdb_id, last_fetched_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT(id) DO UPDATE SET
                title           = EXCLUDED.title,
                year            = EXCLUDED.year,
                runtime         = EXCLUDED.runtime,
                genres          = EXCLUDED.genres,
                vote_average    = EXCLUDED.vote_average,
                vote_count      = EXCLUDED.vote_count,
                popularity      = EXCLUDED.popularity,
                origin_country  = EXCLUDED.origin_country,
                language        = EXCLUDED.language,
                keywords        = EXCLUDED.keywords,
                director        = EXCLUDED.director,
                "cast"          = EXCLUDED."cast",
                raw_tmdb        = EXCLUDED.raw_tmdb,
                feature_vector  = COALESCE(EXCLUDED.feature_vector, movies.feature_vector),
                imdb_id         = COALESCE(movies.imdb_id, EXCLUDED.imdb_id),
                last_fetched_at = NOW()
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
            tmdb_data.get("imdb_id"),
        ))


def batch_upsert_movies(movies: list[dict]) -> None:
    """Upsert multiple TMDB movie records in a single transaction."""
    if not movies:
        return
    rows = []
    for tmdb_data in movies:
        crew = tmdb_data.get("credits", {}).get("crew", [])
        directors = [p["name"] for p in crew if p.get("job") == "Director"]
        cast = [p["name"] for p in tmdb_data.get("credits", {}).get("cast", [])[:10]]
        genres = [g["name"] for g in tmdb_data.get("genres", [])]
        keywords = [k["name"] for k in tmdb_data.get("keywords", {}).get("keywords", [])]
        countries = tmdb_data.get("production_countries", [])
        release = tmdb_data.get("release_date", "") or ""
        rows.append((
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
            tmdb_data.get("imdb_id"),
        ))
    with get_connection() as conn:
        cur = conn.cursor()
        psycopg2.extras.execute_values(cur, """
            INSERT INTO movies (
                id, title, year, runtime, genres, vote_average, vote_count,
                popularity, origin_country, language, keywords, director, "cast",
                raw_tmdb, imdb_id
            ) VALUES %s
            ON CONFLICT(id) DO UPDATE SET
                title           = EXCLUDED.title,
                year            = EXCLUDED.year,
                runtime         = EXCLUDED.runtime,
                genres          = EXCLUDED.genres,
                vote_average    = EXCLUDED.vote_average,
                vote_count      = EXCLUDED.vote_count,
                popularity      = EXCLUDED.popularity,
                origin_country  = EXCLUDED.origin_country,
                language        = EXCLUDED.language,
                keywords        = EXCLUDED.keywords,
                director        = EXCLUDED.director,
                "cast"          = EXCLUDED."cast",
                raw_tmdb        = EXCLUDED.raw_tmdb,
                feature_vector  = COALESCE(movies.feature_vector, EXCLUDED.feature_vector),
                imdb_id         = COALESCE(movies.imdb_id, EXCLUDED.imdb_id),
                last_fetched_at = NOW()
        """, rows)


def update_feature_vector(tmdb_id: int, vector: list[float]) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE movies SET feature_vector = %s WHERE id = %s",
            (json.dumps(vector), tmdb_id),
        )


def batch_update_feature_vectors(pairs: list[tuple[int, list[float]]]) -> None:
    """Update feature_vector for multiple movies in a single transaction."""
    if not pairs:
        return
    with get_connection() as conn:
        cur = conn.cursor()
        psycopg2.extras.execute_values(
            cur,
            """UPDATE movies SET feature_vector = data.vec
               FROM (VALUES %s) AS data(id, vec)
               WHERE movies.id = data.id::bigint""",
            [(mid, json.dumps(vec)) for mid, vec in pairs],
        )


def batch_get_omdb_scores(imdb_ids: list[str]) -> dict[str, dict]:
    """Return cached OMDB scores for multiple movies in a single query.

    Returns a dict keyed by imdb_id. Only includes movies that have been fetched
    (omdb_fetched_at IS NOT NULL). Missing entries need individual API calls.
    """
    if not imdb_ids:
        return {}
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT imdb_id, imdb_score, rt_score, mc_score
               FROM movies
               WHERE imdb_id = ANY(%s) AND omdb_fetched_at IS NOT NULL""",
            (imdb_ids,),
        )
        return {
            row["imdb_id"]: {"imdb": row["imdb_score"], "rt": row["rt_score"], "metacritic": row["mc_score"]}
            for row in cur.fetchall()
        }


def get_movie_omdb_scores(imdb_id: str) -> dict | None:
    """Return cached OMDB scores for a movie, or None if never fetched."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT imdb_score, rt_score, mc_score, omdb_fetched_at FROM movies WHERE imdb_id = %s",
            (imdb_id,),
        )
        row = cur.fetchone()
    if row is None or row["omdb_fetched_at"] is None:
        return None
    return {"imdb": row["imdb_score"], "rt": row["rt_score"], "metacritic": row["mc_score"]}


def save_movie_omdb_scores(imdb_id: str, imdb_score, rt_score, mc_score) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE movies SET imdb_score = %s, rt_score = %s, mc_score = %s,
               omdb_fetched_at = NOW() WHERE imdb_id = %s""",
            (imdb_score, rt_score, mc_score, imdb_id),
        )


def get_imdb_ids_missing_omdb(limit: int = 2000) -> list[str]:
    """Return imdb_ids for movies that have never had OMDB scores fetched."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT imdb_id FROM movies WHERE imdb_id IS NOT NULL AND omdb_fetched_at IS NULL LIMIT %s",
            (limit,),
        )
        return [row["imdb_id"] for row in cur.fetchall()]


def get_candidate_movies(exclude_ids: set[int], limit: int = 500) -> list[dict]:
    """Return movies with feature vectors not in exclude_ids, for candidate ranking.

    Used on non-stale rebuilds to avoid re-running TMDB discovery.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM movies WHERE feature_vector IS NOT NULL AND NOT (id = ANY(%s)) LIMIT %s",
            (list(exclude_ids) if exclude_ids else [], limit),
        )
        rows = cur.fetchall()
    movies = []
    for row in rows:
        m = dict(row)
        m["feature_vector"] = json.loads(m["feature_vector"])
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        movies.append(m)
    return movies


def get_raw_tmdb_for_ids(ids: list[int]) -> dict[int, dict]:
    """Return {tmdb_id: raw_tmdb_dict} for the given IDs that have raw_tmdb stored."""
    if not ids:
        return {}
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, raw_tmdb FROM movies WHERE id = ANY(%s) AND raw_tmdb IS NOT NULL",
            (ids,),
        )
        rows = cur.fetchall()
    return {row["id"]: json.loads(row["raw_tmdb"]) for row in rows}


def get_movies_by_ids(ids: list[int]) -> dict[int, dict]:
    """Batch-fetch movie objects by TMDB ID, returning {id: movie_dict}."""
    if not ids:
        return {}
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM movies WHERE id = ANY(%s)", (ids,))
        rows = cur.fetchall()
    result = {}
    for row in rows:
        m = dict(row)
        m["feature_vector"] = json.loads(m["feature_vector"]) if m.get("feature_vector") else None
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m.get("raw_tmdb") else {}
        result[m["id"]] = m
    return result


def get_movie_title_year_index() -> dict[tuple[str, int | None], int]:
    """Return {(title_lower, year): tmdb_id} for all movies in the DB."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, title, year FROM movies")
        return {(row["title"].lower(), row["year"]): row["id"] for row in cur.fetchall()}


def get_all_movies_with_vectors() -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM movies WHERE feature_vector IS NOT NULL")
        rows = cur.fetchall()
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
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO user_ratings (user_id, movie_id, letterboxd_rating, rated_at, source)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                letterboxd_rating = EXCLUDED.letterboxd_rating,
                rated_at          = COALESCE(EXCLUDED.rated_at, user_ratings.rated_at),
                source            = EXCLUDED.source
        """, (user_id, movie_id, rating, rated_at, source))


def batch_upsert_ratings(rows: list[tuple[int, int, float, str | None, str]]) -> None:
    """Upsert multiple ratings in a single transaction. Each row: (user_id, movie_id, rating, rated_at, source)."""
    if not rows:
        return
    with get_connection() as conn:
        cur = conn.cursor()
        psycopg2.extras.execute_values(cur, """
            INSERT INTO user_ratings (user_id, movie_id, letterboxd_rating, rated_at, source)
            VALUES %s
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                letterboxd_rating = EXCLUDED.letterboxd_rating,
                rated_at          = COALESCE(EXCLUDED.rated_at, user_ratings.rated_at),
                source            = EXCLUDED.source
        """, rows)


def get_user_ratings(user_id: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.letterboxd_rating, r.rated_at, m.*
            FROM user_ratings r
            JOIN movies m ON m.id = r.movie_id
            WHERE r.user_id = %s
        """, (user_id,))
        rows = cur.fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["feature_vector"] = json.loads(m["feature_vector"]) if m["feature_vector"] else None
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        result.append(m)
    return result


def get_ratings_count(user_id: int) -> int:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS count FROM user_ratings WHERE user_id = %s", (user_id,))
        return cur.fetchone()["count"]


# --- user_watchlist ---

def upsert_watchlist_entry(user_id: int, movie_id: int) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_watchlist (user_id, movie_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (user_id, movie_id),
        )


def get_watchlist_count(user_id: int) -> int:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS count FROM user_watchlist WHERE user_id = %s", (user_id,))
        return cur.fetchone()["count"]


def get_user_watchlist(user_id: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT m.*
            FROM user_watchlist w
            JOIN movies m ON m.id = w.movie_id
            WHERE w.user_id = %s
        """, (user_id,))
        rows = cur.fetchall()
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
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO user_watched (user_id, movie_id, watched_at, source)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                watched_at = EXCLUDED.watched_at,
                source     = EXCLUDED.source
        """, (user_id, movie_id, watched_at, source))


def get_seen_movie_ids(user_id: int) -> set[int]:
    """Return all TMDB IDs the user has rated — used to filter candidates."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT movie_id FROM user_ratings WHERE user_id = %s", (user_id,))
        return {row["movie_id"] for row in cur.fetchall()}


# --- taste_profile ---

def compute_ratings_hash(user_id: int) -> str:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT movie_id, letterboxd_rating FROM user_ratings WHERE user_id = %s ORDER BY movie_id",
            (user_id,),
        )
        rows = cur.fetchall()
    h = hashlib.sha256()
    for row in rows:
        h.update(f"{row['movie_id']}:{row['letterboxd_rating']}".encode())
    return h.hexdigest()


def get_taste_profile(user_id: int) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM taste_profile WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
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
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO taste_profile (user_id, vector, ratings_count, version, clusters, ratings_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(user_id) DO UPDATE SET
                vector        = EXCLUDED.vector,
                built_at      = NOW(),
                ratings_count = EXCLUDED.ratings_count,
                version       = EXCLUDED.version,
                clusters      = EXCLUDED.clusters,
                ratings_hash  = EXCLUDED.ratings_hash
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
        cur = conn.cursor()
        cur.execute("""
            SELECT r.letterboxd_rating, r.rated_at,
                   m.id, m.title, m.year, m.genres, m.runtime, m.raw_tmdb
            FROM user_ratings r
            JOIN movies m ON m.id = r.movie_id
            WHERE r.user_id = %s
            ORDER BY r.rated_at DESC
            LIMIT %s
        """, (user_id, limit))
        rows = cur.fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        result.append(m)
    return result


def get_recommendation_history(user_id: int, limit: int = 20) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM (
                SELECT DISTINCT ON (rec.movie_id)
                       rec.id, rec.recommended_at, rec.mood_context, rec.score,
                       m.id as movie_id, m.title, m.year, m.genres, m.runtime, m.raw_tmdb,
                       CASE WHEN r.movie_id IS NOT NULL THEN 1 ELSE 0 END as followed_through,
                       r.letterboxd_rating as follow_up_rating
                FROM recommendations rec
                JOIN movies m ON m.id = rec.movie_id
                LEFT JOIN user_ratings r
                       ON r.user_id = rec.user_id AND r.movie_id = rec.movie_id
                WHERE rec.user_id = %s
                ORDER BY rec.movie_id, rec.recommended_at DESC
            ) deduped
            ORDER BY recommended_at DESC
            LIMIT %s
        """, (user_id, limit))
        rows = cur.fetchall()
    result = []
    for row in rows:
        m = dict(row)
        m["raw_tmdb"] = json.loads(m["raw_tmdb"]) if m["raw_tmdb"] else {}
        m["mood_context"] = json.loads(m["mood_context"]) if m["mood_context"] else {}
        result.append(m)
    return result


def log_recommendation(user_id: int, movie_id: int, score: float, mood_context: dict) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO recommendations (user_id, movie_id, score, mood_context)
            VALUES (%s, %s, %s, %s)
        """, (user_id, movie_id, score, json.dumps(mood_context)))


def get_recent_recommendation_ids(user_id: int, days: int = 14) -> set[int]:
    """Return movie IDs recommended to this user in the last N days."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT movie_id FROM recommendations
            WHERE user_id = %s
              AND recommended_at >= NOW() - INTERVAL '1 day' * %s
        """, (user_id, days))
        rows = cur.fetchall()
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
        cur = conn.cursor()
        cur.execute("""
            UPDATE recommendations
            SET outcome = CASE
                WHEN (SELECT letterboxd_rating FROM user_ratings
                      WHERE user_id = %s AND movie_id = recommendations.movie_id) >= 3.5
                    THEN 'enjoyed'
                WHEN (SELECT letterboxd_rating FROM user_ratings
                      WHERE user_id = %s AND movie_id = recommendations.movie_id) <= 2.5
                    THEN 'disliked'
                ELSE 'rated_neutral'
            END,
            resolved_at = NOW()
            WHERE user_id = %s
              AND outcome IS NULL
              AND movie_id IN (SELECT movie_id FROM user_ratings WHERE user_id = %s)
        """, (user_id, user_id, user_id, user_id))



def get_recommendation_boosts(user_id: int) -> dict[int, float]:
    """Return {movie_id: weight_multiplier} for recommendations with confirmed outcomes.

    Only enjoyed and disliked outcomes get a boost — both get 1.5x so the profile
    pulls more strongly toward validated wins and away from confirmed misses.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT movie_id, outcome FROM recommendations
            WHERE user_id = %s AND outcome IN ('enjoyed', 'disliked')
        """, (user_id,))
        rows = cur.fetchall()
    return {row["movie_id"]: 1.5 for row in rows}
