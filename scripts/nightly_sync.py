"""
Nightly scrape of recent Letterboxd activity for all users with a linked account.

Intended to run as a Railway Cron service on a nightly schedule. Picks up any
user with a letterboxd_username set — no config changes needed when new users
are added.

Sleep between users scales to spread the job across ~30 minutes (min 2s),
keeping Letterboxd request rate reasonable regardless of user count.
"""

import logging
import os
import sys
import time
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, close_db, get_users_with_letterboxd
from filmprint.sync import sync_rss, sync_scrape

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
    failed = 0

    for i, user in enumerate(users, start=1):
        username = user["letterboxd_username"]
        user_id = user["id"]
        log.info("[%d/%d] Syncing %s (user_id=%d)", i, total, username, user_id)

        try:
            rss_ratings, rss_watchlist = sync_rss(user_id, username)
            log.info("[%d/%d] RSS: %s — %d ratings, %d watchlist", i, total, username, rss_ratings, rss_watchlist)
            sync_scrape(user_id, username)
            log.info("[%d/%d] Done: %s", i, total, username)
            succeeded += 1
        except Exception:
            log.exception("[%d/%d] Failed to sync %s", i, total, username)
            failed += 1

        if i < total:
            time.sleep(sleep_secs)

    log.info(
        "Nightly sync complete — %d succeeded, %d failed (of %d total)",
        succeeded,
        failed,
        total,
    )

    _rebuild_all_profiles()

    close_db()
    if failed:
        sys.exit(1)


def _rebuild_all_profiles() -> None:
    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    internal_secret = os.getenv("INTERNAL_SECRET", "")
    if not backend_url or not internal_secret:
        log.warning("BACKEND_URL or INTERNAL_SECRET not set — skipping bulk profile rebuild")
        return
    log.info("Starting bulk profile rebuild…")
    req = urllib.request.Request(
        f"{backend_url}/api/admin/rebuild-all",
        method="POST",
        headers={"X-Internal-Secret": internal_secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=7200) as resp:
            for raw_line in resp:
                line = raw_line.decode().strip()
                if line:
                    log.info("[rebuild-all] %s", line)
    except Exception:
        log.exception("Bulk profile rebuild failed")


if __name__ == "__main__":
    main()
