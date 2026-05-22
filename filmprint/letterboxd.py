"""Letterboxd data ingestion — CSV export parsing and RSS feed polling."""

import feedparser
import pandas as pd
from pathlib import Path


def load_ratings_csv(path: str) -> pd.DataFrame:
    """Load a Letterboxd ratings CSV export into a DataFrame."""
    df = pd.read_csv(path)
    # Expected columns: Date, Name, Year, Letterboxd URI, Rating
    df = df.rename(columns={"Name": "title", "Year": "year", "Rating": "rating"})
    df = df.dropna(subset=["rating"])
    df["rating"] = df["rating"].astype(float)
    return df[["title", "year", "rating"]]


def load_watchlist_csv(path: str) -> pd.DataFrame:
    """Load a Letterboxd watchlist CSV export into a DataFrame."""
    df = pd.read_csv(path)
    df = df.rename(columns={"Name": "title", "Year": "year"})
    return df[["title", "year"]]


def load_watched_csv(path: str) -> pd.DataFrame:
    """Load a Letterboxd watched CSV export into a DataFrame."""
    df = pd.read_csv(path)
    df = df.rename(columns={"Name": "title", "Year": "year"})
    return df[["title", "year"]]


def fetch_rss_ratings(username: str) -> list[dict]:
    """Fetch recent diary entries (with ratings) from Letterboxd RSS."""
    url = f"https://letterboxd.com/{username}/rss/"
    feed = feedparser.parse(url)
    entries = []
    for entry in feed.entries:
        rating = getattr(entry, "letterboxd_memberrating", None)
        title = getattr(entry, "letterboxd_filmtitle", entry.get("title", ""))
        year = getattr(entry, "letterboxd_filmyear", None)
        if rating:
            entries.append({
                "title": title,
                "year": int(year) if year else None,
                "rating": float(rating),
            })
    return entries


def fetch_rss_watchlist(username: str) -> list[dict]:
    """Fetch watchlist entries from Letterboxd RSS."""
    url = f"https://letterboxd.com/{username}/watchlist/rss/"
    feed = feedparser.parse(url)
    entries = []
    for entry in feed.entries:
        title = getattr(entry, "letterboxd_filmtitle", entry.get("title", ""))
        year = getattr(entry, "letterboxd_filmyear", None)
        entries.append({
            "title": title,
            "year": int(year) if year else None,
        })
    return entries
