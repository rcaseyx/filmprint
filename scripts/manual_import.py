"""
Manually import a Letterboxd export zip for a specific user, then trigger
a full profile rebuild on the live backend.

Usage:
    railway run python scripts/manual_import.py <user_email> <path_to_zip>

Requires INTERNAL_SECRET and BACKEND_URL env vars (both available via railway run).
"""

import sys
import zipfile
import tempfile
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(override=True)

import requests as _requests
from filmprint.db import init_db, get_user_by_email, get_movie_title_year_index
from filmprint.sync import sync_ratings_csv, sync_watchlist_csv


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/manual_import.py <user_email> <zip_path>")
        sys.exit(1)

    email = sys.argv[1]
    zip_path = Path(sys.argv[2])

    if not zip_path.exists():
        print(f"File not found: {zip_path}")
        sys.exit(1)

    internal_secret = os.environ.get("INTERNAL_SECRET", "")
    backend_url = os.environ.get("BACKEND_URL", "https://filmprint-backend-production.up.railway.app")

    init_db()

    user = get_user_by_email(email)
    if not user:
        print(f"No user found with email: {email}")
        sys.exit(1)

    user_id = user["id"]
    print(f"User found: id={user_id}, username={user.get('letterboxd_username')}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp_path)

        ratings_csv = next(tmp_path.rglob("ratings.csv"), None)
        watchlist_csv = next(tmp_path.rglob("watchlist.csv"), None)

        if not ratings_csv and not watchlist_csv:
            print("No ratings.csv or watchlist.csv found in zip")
            sys.exit(1)

        db_index = get_movie_title_year_index()

        if ratings_csv:
            print(f"Syncing ratings...")
            count = sync_ratings_csv(user_id, str(ratings_csv), db_index)
            print(f"  {count} ratings synced")

        if watchlist_csv:
            print(f"Syncing watchlist...")
            count = sync_watchlist_csv(user_id, str(watchlist_csv), db_index)
            print(f"  {count} watchlist entries synced")

    print("\nTriggering profile rebuild on backend...")
    resp = _requests.post(
        f"{backend_url}/api/internal/rebuild/{user_id}",
        headers={"X-Internal-Secret": internal_secret},
        timeout=600,
    )
    if resp.status_code == 200:
        print("Rebuild complete. User is ready to go.")
    else:
        print(f"Rebuild request failed ({resp.status_code}): {resp.text}")
        print("User can still log in — profile will rebuild on first recommendation request.")


if __name__ == "__main__":
    main()
