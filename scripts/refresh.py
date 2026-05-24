"""
Refresh Letterboxd data from RSS and sync into the database.
Run periodically to pick up new ratings and watchlist additions.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, get_all_users
from filmprint.sync import sync_rss


def refresh():
    init_db()
    users = get_all_users()
    if not users:
        print("No users found. Run main.py first to set up your account.")
        return
    for user in users:
        print(f"Refreshing {user['letterboxd_username']}...")
        ratings_added, watchlist_added = sync_rss(user["id"], user["letterboxd_username"])
        print(f"  {ratings_added} ratings, {watchlist_added} watchlist entries added.")
    print(f"RSS sync complete: {ratings_added} ratings, {watchlist_added} watchlist entries.")


if __name__ == "__main__":
    refresh()
