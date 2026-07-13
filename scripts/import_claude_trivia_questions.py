"""
Imports the Claude-authored trivia questions generated in a separate session
(see scripts/trivia_question_prompt.md) from data/trivia_questions.jsonl into
trivia_questions, tagged source='claude'.

Expects one JSON object per line: {movie_id, difficulty, question_text,
correct_answer, options}. Validates before inserting -- correct_answer must be
one of the 4 distinct options, movie_id must be a real movie. Safe to re-run:
skips any question text already cached for source='claude' (same idempotency
pattern as scripts/backfill_trivia_questions.py for opentdb).

Usage:
    python scripts/import_claude_trivia_questions.py
"""

import json
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, close_db, get_existing_question_texts, insert_trivia_questions, get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

INPUT_PATH = Path(__file__).parent.parent / "data" / "trivia_questions.jsonl"
VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def _known_movie_ids(movie_ids: set[int]) -> set[int]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM movies WHERE id = ANY(%s)", (list(movie_ids),))
        return {row["id"] for row in cur.fetchall()}


def _validate(q: dict, known_ids: set[int]) -> str | None:
    """Returns an error message, or None if valid."""
    if q.get("movie_id") not in known_ids:
        return f"unknown movie_id {q.get('movie_id')}"
    if q.get("difficulty") not in VALID_DIFFICULTIES:
        return f"invalid difficulty {q.get('difficulty')!r}"
    if not q.get("question_text") or not q.get("correct_answer"):
        return "missing question_text or correct_answer"
    options = q.get("options")
    if not isinstance(options, list) or len(set(options)) != 4:
        return f"options must be 4 distinct strings, got {options!r}"
    if q["correct_answer"] not in options:
        return "correct_answer not in options"
    return None


def main() -> None:
    if not INPUT_PATH.exists():
        print(f"No file at {INPUT_PATH} -- run the prompt in scripts/trivia_question_prompt.md first")
        sys.exit(1)

    init_db()

    raw_questions = []
    with open(INPUT_PATH) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                raw_questions.append(json.loads(line))
            except json.JSONDecodeError as e:
                log.error("Line %d: invalid JSON (%s) -- aborting, fix the file and re-run", line_num, e)
                close_db()
                sys.exit(1)

    known_ids = _known_movie_ids({q.get("movie_id") for q in raw_questions if isinstance(q.get("movie_id"), int)})

    valid = []
    invalid = []
    for q in raw_questions:
        error = _validate(q, known_ids)
        if error:
            invalid.append((q, error))
        else:
            valid.append(q)

    if invalid:
        log.warning("%d question(s) failed validation and will be skipped:", len(invalid))
        for q, error in invalid[:20]:
            log.warning("  movie_id=%s: %s", q.get("movie_id"), error)

    existing_texts = get_existing_question_texts("claude")
    new_questions = [
        {
            "movie_id": q["movie_id"],
            "source": "claude",
            "question_type": "claude",
            "question_text": q["question_text"],
            "correct_answer": q["correct_answer"],
            "options": q["options"],
            "difficulty": q["difficulty"],
        }
        for q in valid
        if q["question_text"] not in existing_texts
    ]
    skipped_dupes = len(valid) - len(new_questions)

    inserted = insert_trivia_questions(new_questions)

    log.info(
        "Read %d lines: %d valid, %d invalid (skipped), %d already cached (skipped), %d newly inserted",
        len(raw_questions), len(valid), len(invalid), skipped_dupes, len(inserted),
    )
    close_db()


if __name__ == "__main__":
    main()
