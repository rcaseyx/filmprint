"""Sync Letterboxd CSV exports and RSS feeds into the database."""

import os
from rich.console import Console
from rich.progress import track

from .db import (
    upsert_movie, upsert_rating, upsert_watchlist_entry,
    upsert_watched, get_movie,
)
from .letterboxd import (
    load_ratings_csv, load_watchlist_csv, load_watched_csv,
    fetch_rss_ratings, fetch_rss_watchlist,
    scrape_ratings, scrape_watchlist,
)
from .tmdb import enrich_movie

console = Console()


def _ensure_movie(title: str, year: int | None) -> int | None:
    """Fetch movie from DB or TMDB. Returns TMDB id or None if not found."""
    from .tmdb import search_movie
    match = search_movie(title, year)
    if not match:
        return None
    tmdb_id = match["id"]
    if not get_movie(tmdb_id):
        enriched = enrich_movie(title, year)
        if enriched:
            upsert_movie(enriched)
    return tmdb_id


def sync_ratings_csv(user_id: int, path: str) -> int:
    df = load_ratings_csv(path)
    synced = 0
    for _, row in track(df.iterrows(), description="Syncing ratings...", total=len(df)):
        tmdb_id = _ensure_movie(row["title"], row.get("year"))
        if tmdb_id:
            upsert_rating(user_id, tmdb_id, row["rating"], row.get("Date"), source="csv")
            synced += 1
    return synced


def sync_watchlist_csv(user_id: int, path: str) -> int:
    df = load_watchlist_csv(path)
    synced = 0
    for _, row in track(df.iterrows(), description="Syncing watchlist...", total=len(df)):
        tmdb_id = _ensure_movie(row["title"], row.get("year"))
        if tmdb_id:
            upsert_watchlist_entry(user_id, tmdb_id)
            synced += 1
    return synced


def sync_watched_csv(user_id: int, path: str) -> int:
    df = load_watched_csv(path)
    synced = 0
    for _, row in track(df.iterrows(), description="Syncing watched...", total=len(df)):
        tmdb_id = _ensure_movie(row["title"], row.get("year"))
        if tmdb_id:
            upsert_watched(user_id, tmdb_id, row.get("Date"), source="csv")
            synced += 1
    return synced


def sync_scrape(user_id: int, username: str) -> None:
    """Full scrape of a public Letterboxd profile — upserts all ratings and watchlist entries."""
    ratings = scrape_ratings(username)
    watchlist = scrape_watchlist(username)

    for entry in track(ratings, description="Syncing scraped ratings..."):
        tmdb_id = _ensure_movie(entry["title"], entry.get("year"))
        if tmdb_id:
            upsert_rating(user_id, tmdb_id, entry["rating"], None, source="scrape")

    for entry in track(watchlist, description="Syncing scraped watchlist..."):
        tmdb_id = _ensure_movie(entry["title"], entry.get("year"))
        if tmdb_id:
            upsert_watchlist_entry(user_id, tmdb_id)


def sync_rss(user_id: int, username: str) -> tuple[int, int]:
    """Sync incremental updates from Letterboxd RSS. Returns (ratings_added, watchlist_added)."""
    ratings = fetch_rss_ratings(username)
    watchlist = fetch_rss_watchlist(username)

    ratings_added = 0
    for entry in track(ratings, description="Syncing RSS ratings..."):
        tmdb_id = _ensure_movie(entry["title"], entry.get("year"))
        if tmdb_id:
            upsert_rating(user_id, tmdb_id, entry["rating"], None, source="rss")
            ratings_added += 1

    watchlist_added = 0
    for entry in track(watchlist, description="Syncing RSS watchlist..."):
        tmdb_id = _ensure_movie(entry["title"], entry.get("year"))
        if tmdb_id:
            upsert_watchlist_entry(user_id, tmdb_id)
            watchlist_added += 1

    return ratings_added, watchlist_added
