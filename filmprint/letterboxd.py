"""Letterboxd data ingestion — CSV export parsing, RSS feed polling, and profile scraping."""

import re
import time
import feedparser
import requests
from bs4 import BeautifulSoup
from pathlib import Path

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; filmprint/1.0)"}


def load_ratings_csv(path: str) -> list[dict]:
    """Load a Letterboxd ratings CSV export. Expected columns: Date, Name, Year, Rating."""
    import csv as _csv
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in _csv.DictReader(f):
            if not row.get("Rating"):
                continue
            try:
                rating = float(row["Rating"])
            except (ValueError, TypeError):
                continue
            rows.append({
                "title": row.get("Name", ""),
                "year": int(row["Year"]) if row.get("Year") else None,
                "rating": rating,
                "date": row.get("Date"),
            })
    return rows


def load_watchlist_csv(path: str) -> list[dict]:
    """Load a Letterboxd watchlist CSV export."""
    import csv as _csv
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [
            {"title": row.get("Name", ""), "year": int(row["Year"]) if row.get("Year") else None}
            for row in _csv.DictReader(f)
        ]


def load_watched_csv(path: str) -> list[dict]:
    """Load a Letterboxd watched CSV export."""
    import csv as _csv
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [
            {"title": row.get("Name", ""), "year": int(row["Year"]) if row.get("Year") else None}
            for row in _csv.DictReader(f)
        ]


def validate_username(username: str) -> bool:
    """Return True if the Letterboxd username exists (RSS feed responds with 200).

    Raises requests.RequestException on network failure — callers should surface
    this as a retryable error rather than silently saving an unvalidated username.
    """
    res = requests.head(
        f"https://letterboxd.com/{username}/rss/",
        headers=_HEADERS,
        timeout=8,
        allow_redirects=True,
    )
    return res.status_code == 200


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
    """Scrape the most recently released rated films from a public Letterboxd profile.

    Letterboxd only serves the first page (~72 films) without authentication.
    The /films/by/date/ sort URL returns 403 for automated clients, so we use
    the default release-date sort. For full history, users should import their
    Letterboxd CSV export.
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
