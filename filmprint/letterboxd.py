"""Letterboxd data ingestion — CSV export parsing, RSS feed polling, and profile scraping."""

import re
import time
import feedparser
import pandas as pd
import requests
from bs4 import BeautifulSoup
from pathlib import Path

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; filmprint/1.0)"}


def load_ratings_csv(path: str) -> pd.DataFrame:
    """Load a Letterboxd ratings CSV export into a DataFrame."""
    df = pd.read_csv(path)
    # Expected columns: Date, Name, Year, Letterboxd URI, Rating
    df = df.rename(columns={"Name": "title", "Year": "year", "Rating": "rating", "Date": "date"})
    df = df.dropna(subset=["rating"])
    df["rating"] = df["rating"].astype(float)
    return df[["title", "year", "rating", "date"]]


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
    import time as _time
    url = f"https://letterboxd.com/{username}/rss/"
    feed = feedparser.parse(url)
    entries = []
    for entry in feed.entries:
        rating = getattr(entry, "letterboxd_memberrating", None)
        title = getattr(entry, "letterboxd_filmtitle", entry.get("title", ""))
        year = getattr(entry, "letterboxd_filmyear", None)
        published = entry.get("published_parsed")
        if rating:
            entries.append({
                "title": title,
                "year": int(year) if year else None,
                "rating": float(rating),
                "date": _time.strftime("%Y-%m-%d", published) if published else None,
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


def _parse_name_year(raw: str) -> tuple[str, int | None]:
    """Split 'Movie Title (2024)' into ('Movie Title', 2024)."""
    m = re.search(r'\((\d{4})\)\s*$', raw)
    if m:
        return raw[:m.start()].strip(), int(m.group(1))
    return raw.strip(), None


def _scrape_grid_page(url: str) -> tuple[list[dict], bool]:
    """Scrape one page of a Letterboxd grid. Returns (items, has_next)."""
    resp = requests.get(url, headers=_HEADERS, timeout=15)
    if resp.status_code != 200:
        return [], False
    soup = BeautifulSoup(resp.text, "html.parser")
    items = []
    for li in soup.select("li.griditem"):
        slug_el = li.select_one("[data-item-slug]")
        if not slug_el:
            continue
        slug = slug_el.get("data-item-slug", "")
        name = slug_el.get("data-item-name", "") or slug.replace("-", " ")
        title, year = _parse_name_year(name)
        rated_span = li.find(class_=re.compile(r"^rated-\d+$"))
        rating = None
        if rated_span:
            rc = next(
                (c for c in rated_span.get("class", []) if c.startswith("rated-")),
                None,
            )
            if rc:
                rating = int(rc.removeprefix("rated-")) / 2
        items.append({"slug": slug, "title": title, "year": year, "rating": rating})
    has_next = bool(soup.select_one("a.next"))
    return items, has_next


def scrape_ratings(username: str) -> list[dict]:
    """Scrape the most recent rated films from a public Letterboxd profile.

    Letterboxd only serves the first page (~72 films) of ratings without
    authentication. Paginated URLs (/films/page/N/) return 403. For full
    history, users should import their Letterboxd CSV export.
    """
    items, _ = _scrape_grid_page(f"https://letterboxd.com/{username}/films/")
    return [e for e in items if e["rating"] is not None]


def scrape_watchlist(username: str) -> list[dict]:
    """Scrape all films from a public Letterboxd watchlist (all pages public)."""
    entries = []
    page = 1
    while True:
        url = f"https://letterboxd.com/{username}/watchlist/page/{page}/"
        items, has_next = _scrape_grid_page(url)
        if not items:
            break
        entries.extend(items)
        if not has_next:
            break
        page += 1
        time.sleep(0.3)
    return entries
