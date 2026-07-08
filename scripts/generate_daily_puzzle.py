"""
Generate tomorrow's six-degrees daily puzzle and store it in daily_puzzles.
Run once per day (e.g. via a Railway cron/scheduled job).
"""

import sys
from datetime import date, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, get_recent_anchor_movie_ids, insert_daily_puzzle
from filmprint.six_degrees import generate_daily_puzzle, ANCHOR_COOLDOWN_DAYS


def main():
    init_db()
    puzzle_date = date.today() + timedelta(days=1)
    exclude = get_recent_anchor_movie_ids(ANCHOR_COOLDOWN_DAYS)
    puzzle = generate_daily_puzzle(exclude_movie_ids=exclude)
    puzzle_id = insert_daily_puzzle(
        puzzle_date,
        puzzle["start_movie_id"],
        puzzle["end_movie_id"],
        puzzle["solution_path"],
        puzzle["degree_count"],
    )
    print(
        f"Generated puzzle #{puzzle_id} for {puzzle_date}: "
        f"{puzzle['start_movie_id']} -> {puzzle['end_movie_id']} "
        f"({puzzle['degree_count']} degrees)"
    )


if __name__ == "__main__":
    main()
