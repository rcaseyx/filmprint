"""
One-time (or ad-hoc) pull of Open Trivia DB's Film category into
trivia_questions, so general trivia questions can be served from our own
cache instead of live-fetching per game session -- OTDB has a hard
5-second-per-IP rate limit and only ~300 questions in the category total,
neither of which suits per-request live calls. Safe to re-run: skips any
question text already cached, so it'll only pick up newly-added OTDB
questions on a later run.

Usage:
    python scripts/backfill_trivia_questions.py
"""

import logging
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, close_db, get_existing_opentdb_question_texts, insert_trivia_questions
from filmprint.opentdb import fetch_film_questions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

_BATCH_SIZE = 50
_REQUEST_INTERVAL_SECONDS = 5.5  # OTDB's limit is 5s/IP; small margin for safety
_MAX_BATCHES = 20  # generous cap; OTDB signals exhaustion itself well before this


def main() -> None:
    init_db()
    existing_texts = get_existing_opentdb_question_texts()
    log.info("Starting Open Trivia DB backfill (%d questions already cached)", len(existing_texts))

    total_fetched = 0
    total_inserted = 0
    for batch_num in range(_MAX_BATCHES):
        questions = fetch_film_questions(amount=_BATCH_SIZE)
        if not questions:
            log.info("OTDB reports no more questions available -- stopping")
            break

        total_fetched += len(questions)
        new_questions = [
            {**q, "movie_id": None, "source": "opentdb", "question_type": "opentdb", "image_url": None}
            for q in questions
            if q["question_text"] not in existing_texts
        ]
        existing_texts.update(q["question_text"] for q in new_questions)
        insert_trivia_questions(new_questions)
        total_inserted += len(new_questions)
        log.info(
            "batch %d: %d fetched, %d new (%d already cached, skipped)",
            batch_num + 1, len(questions), len(new_questions), len(questions) - len(new_questions),
        )

        if batch_num < _MAX_BATCHES - 1:
            time.sleep(_REQUEST_INTERVAL_SECONDS)

    log.info("Backfill complete: %d fetched, %d newly inserted", total_fetched, total_inserted)
    close_db()


if __name__ == "__main__":
    main()
