"""
Generate tomorrow's six-degrees daily puzzle and store it in daily_puzzles.
Normally runs as part of scripts/nightly_sync.py's Railway cron job; this
script exists for manual/ad-hoc regeneration.
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db
from filmprint.six_degrees import generate_and_store_tomorrows_puzzle


def main():
    init_db()
    puzzle = generate_and_store_tomorrows_puzzle()
    if puzzle is None:
        print("Puzzle for tomorrow already exists — skipped.")
        return
    print(
        f"Generated puzzle #{puzzle['id']} for {puzzle['puzzle_date']}: "
        f"{puzzle['start_movie_id']} -> {puzzle['end_movie_id']} "
        f"({puzzle['degree_count']} degrees)"
    )


if __name__ == "__main__":
    main()
