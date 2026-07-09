"""
Nightly scrape of recent Letterboxd activity for all users with a linked account.

Intended to run as a Railway Cron service on a nightly schedule. Picks up any
user with a letterboxd_username set — no config changes needed when new users
are added.

Sleep between users scales to spread the job across ~30 minutes (min 2s),
keeping Letterboxd request rate reasonable regardless of user count.
"""

import json
import logging
import os
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, close_db, get_ratings_count, get_users_with_letterboxd
from filmprint.sync import sync_rss, sync_scrape
from filmprint.six_degrees import generate_and_store_tomorrows_puzzle
from filmprint.catalog import sweep_popular_movies

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

_SPREAD_WINDOW_SECONDS = 1800  # target: spread all users across ~30 min
_MIN_SLEEP_SECONDS = 2


def main() -> None:
    log.info("Nightly sync starting")
    init_db()

    users = get_users_with_letterboxd()
    total = len(users)

    if not users:
        log.info("No users with a Letterboxd username — nothing to do")
        return

    sleep_secs = max(_MIN_SLEEP_SECONDS, _SPREAD_WINDOW_SECONDS / total)
    log.info("Found %d user(s) — sleeping %.1fs between each", total, sleep_secs)

    succeeded = 0
    failed_users = []
    users_with_new_ratings: set[int] = set()

    for i, user in enumerate(users, start=1):
        username = user["letterboxd_username"]
        user_id = user["id"]
        label = f"[{i}/{total}]"
        log.info("%s Syncing %s (user_id=%d)", label, username, user_id)

        ok, new_ratings = _sync_user(user_id, username, label)
        if ok:
            succeeded += 1
            if new_ratings > 0:
                users_with_new_ratings.add(user_id)
        else:
            failed_users.append(user)

        if i < total:
            time.sleep(sleep_secs)

    if failed_users:
        log.info("Retrying %d failed user(s)", len(failed_users))
        still_failed = []
        for i, user in enumerate(failed_users, start=1):
            username = user["letterboxd_username"]
            user_id = user["id"]
            label = f"[retry {i}/{len(failed_users)}]"
            log.info("%s Syncing %s (user_id=%d)", label, username, user_id)

            ok, new_ratings = _sync_user(user_id, username, label)
            if ok:
                succeeded += 1
                if new_ratings > 0:
                    users_with_new_ratings.add(user_id)
            else:
                still_failed.append(user)
        failed_users = still_failed

    log.info(
        "Nightly sync complete — %d succeeded, %d failed (of %d total)",
        succeeded,
        len(failed_users),
        total,
    )

    log.info("%d user(s) picked up new ratings tonight", len(users_with_new_ratings))
    _rebuild_all_profiles(users_with_new_ratings)

    _generate_six_degrees_puzzle()

    if date.today().day == 1:
        _backfill_recent_catalog()

    close_db()
    if succeeded == 0:
        sys.exit(1)


def _sync_user(user_id: int, username: str, label: str) -> tuple[bool, int]:
    """Returns (success, new_ratings_count). new_ratings_count is a DB row-count
    delta, not the RSS feed's own count, since the RSS feed re-lists recent
    ratings on every sync regardless of whether they're already known."""
    before = get_ratings_count(user_id)
    try:
        rss_ratings, rss_watchlist = sync_rss(user_id, username)
        log.info("%s RSS: %s — %d ratings, %d watchlist", label, username, rss_ratings, rss_watchlist)
        sync_scrape(user_id, username)
        log.info("%s Done: %s", label, username)
        new_ratings = get_ratings_count(user_id) - before
        return True, new_ratings
    except Exception:
        log.exception("%s Failed to sync %s", label, username)
        return False, 0


def _rebuild_all_profiles(users_with_new_ratings: set[int]) -> None:
    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    internal_secret = os.getenv("INTERNAL_SECRET", "")
    if not backend_url or not internal_secret:
        log.warning("BACKEND_URL or INTERNAL_SECRET not set — skipping bulk profile rebuild")
        return
    log.info("Starting bulk profile rebuild…")
    body = json.dumps({"users_with_new_ratings": sorted(users_with_new_ratings)}).encode()
    req = urllib.request.Request(
        f"{backend_url}/api/admin/rebuild-all",
        method="POST",
        data=body,
        headers={"X-Internal-Secret": internal_secret, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=7200) as resp:
            for raw_line in resp:
                line = raw_line.decode().strip()
                if line:
                    log.info("[rebuild-all] %s", line)
    except Exception:
        log.exception("Bulk profile rebuild failed")


def _generate_six_degrees_puzzle() -> None:
    try:
        puzzle = generate_and_store_tomorrows_puzzle()
        if puzzle is None:
            log.info("Six-degrees puzzle for tomorrow already exists — skipped")
        else:
            log.info(
                "Generated six-degrees puzzle #%s for %s (%d degrees)",
                puzzle["id"], puzzle["puzzle_date"], puzzle["degree_count"],
            )
    except Exception:
        log.exception("Six-degrees puzzle generation failed")


def _backfill_recent_catalog() -> None:
    """Monthly sweep of the last few years so recent releases get picked up
    once they cross the popularity/vote-count bar (new movies won't have
    enough votes on day one). Gated to the 1st of the month by the caller."""
    try:
        year = date.today().year
        stats = sweep_popular_movies(year - 2, year, per_year_limit=100)
        log.info("Catalog backfill sweep: %s", stats)
    except Exception:
        log.exception("Catalog backfill sweep failed")


if __name__ == "__main__":
    main()
