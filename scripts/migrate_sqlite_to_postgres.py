#!/usr/bin/env python3
"""
One-time migration: SQLite → PostgreSQL.

Usage:
    DATABASE_URL=postgres://... python scripts/migrate_sqlite_to_postgres.py

Reads data/filmprint.db (read-only). Writes to the Postgres DB specified by
DATABASE_URL. Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING.
"""

import os
import sqlite3
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

SQLITE_PATH = Path(__file__).parent.parent / "data" / "filmprint.db"


def _rows(sqlite, table):
    return [tuple(row) for row in sqlite.execute(f"SELECT * FROM {table}").fetchall()]


def migrate() -> None:
    if not SQLITE_PATH.exists():
        print(f"ERROR: SQLite DB not found at {SQLITE_PATH}")
        sys.exit(1)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    print(f"Source: {SQLITE_PATH}")
    print(f"Target: {database_url[:40]}...")

    sqlite = sqlite3.connect(SQLITE_PATH)
    sqlite.row_factory = sqlite3.Row

    pg = psycopg2.connect(database_url)
    cur = pg.cursor()

    try:
        # users
        data = _rows(sqlite, "users")
        print(f"\nMigrating {len(data)} users...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO users (id, email, letterboxd_username, created_at, password_hash)
            VALUES %s ON CONFLICT DO NOTHING
        """, [(r[0], r[1], r[2], r[3], r[4]) for r in data])

        # movies (large blobs — use small page size to avoid oversized queries)
        data = _rows(sqlite, "movies")
        print(f"Migrating {len(data)} movies (this is the big one)...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO movies (
                id, title, year, runtime, genres, vote_average, vote_count,
                popularity, origin_country, language, keywords, director, "cast",
                raw_tmdb, feature_vector, last_fetched_at
            ) VALUES %s ON CONFLICT DO NOTHING
        """, data, page_size=50)

        # keyword_themes
        data = _rows(sqlite, "keyword_themes")
        print(f"Migrating {len(data)} keyword_themes...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO keyword_themes (keyword, theme, source, created_at)
            VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # theme_centroids
        data = _rows(sqlite, "theme_centroids")
        print(f"Migrating {len(data)} theme_centroids...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO theme_centroids (theme, centroid, updated_at)
            VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # user_ratings
        data = _rows(sqlite, "user_ratings")
        print(f"Migrating {len(data)} user_ratings...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO user_ratings (id, user_id, movie_id, letterboxd_rating, rated_at, source)
            VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # user_watchlist
        data = _rows(sqlite, "user_watchlist")
        print(f"Migrating {len(data)} user_watchlist entries...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO user_watchlist (id, user_id, movie_id, added_at)
            VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # user_watched
        data = _rows(sqlite, "user_watched")
        print(f"Migrating {len(data)} user_watched entries...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO user_watched (id, user_id, movie_id, watched_at, source)
            VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # taste_profile
        data = _rows(sqlite, "taste_profile")
        print(f"Migrating {len(data)} taste_profile rows...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO taste_profile (
                id, user_id, vector, built_at, ratings_count,
                version, clusters, ratings_hash
            ) VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # recommendations
        data = _rows(sqlite, "recommendations")
        print(f"Migrating {len(data)} recommendations...")
        psycopg2.extras.execute_values(cur, """
            INSERT INTO recommendations (
                id, user_id, movie_id, recommended_at, mood_context,
                score, outcome, resolved_at
            ) VALUES %s ON CONFLICT DO NOTHING
        """, data)

        # Reset BIGSERIAL sequences to match the highest existing ID.
        # Without this, the next auto-generated ID would collide with migrated rows.
        print("\nResetting sequences...")
        for table, seq in [
            ("users",           "users_id_seq"),
            ("user_ratings",    "user_ratings_id_seq"),
            ("user_watchlist",  "user_watchlist_id_seq"),
            ("user_watched",    "user_watched_id_seq"),
            ("taste_profile",   "taste_profile_id_seq"),
            ("recommendations", "recommendations_id_seq"),
        ]:
            cur.execute(f"SELECT setval('{seq}', COALESCE((SELECT MAX(id) FROM {table}), 1))")

        pg.commit()
        print("Migration complete.")

    except Exception as e:
        pg.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        sqlite.close()
        pg.close()


if __name__ == "__main__":
    migrate()
