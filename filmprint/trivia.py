"""Trivia: Claude-authored + Open Trivia DB game.

Both question sources are pre-generated, not built per-request. Claude-authored
questions (source='claude') were hand-written in a separate session from a CSV
export of the top 250 movies (see scripts/export_trivia_source_movies.py and
scripts/trivia_question_prompt.md) and imported via
scripts/import_claude_trivia_questions.py. Open Trivia DB questions
(source='opentdb') came from scripts/backfill_trivia_questions.py. This
replaces an earlier per-user taste-graph generator (questions built live from
a user's own rated movies) -- dropped because its output was repetitive and
too easy/obvious after a couple of rounds; see project memory for history.
"""

import random

from filmprint.db import (
    get_random_trivia_questions, get_trivia_question_by_id,
    get_user_seen_trivia_question_ids, mark_trivia_questions_seen,
)

SESSION_SIZE_DEFAULT = 10
# Mostly Claude-authored (the richer, hand-written pool) with a small OTDB
# slice for variety/breadth beyond the 250-movie Claude set.
CLAUDE_TARGET = 8


def build_session(user_id: int, count: int = SESSION_SIZE_DEFAULT) -> list[dict]:
    """Mostly Claude-authored, rest OTDB, excluding questions this user has
    already been shown (not just ones they've answered) wherever the unseen
    pool supports it. user_id is only used for this seen-question exclusion --
    question selection itself isn't personalized/taste-based."""
    seen = get_user_seen_trivia_question_ids(user_id)

    claude = get_random_trivia_questions(source="claude", limit=CLAUDE_TARGET, exclude_ids=seen)
    otdb_target = count - len(claude)  # shortfall backfills from OTDB
    otdb = get_random_trivia_questions(source="opentdb", limit=otdb_target, exclude_ids=seen)

    session = claude + otdb
    if len(session) < count:
        # Both sources' unseen pools ran dry (a heavy player has now seen most
        # of what exists) -- top off with repeats rather than returning a short
        # session. Still excludes this session's own picks so it can't dupe a
        # question within itself.
        already_picked = {q["id"] for q in session}
        remaining = count - len(session)
        backfill = get_random_trivia_questions(source="claude", limit=remaining, exclude_ids=already_picked)
        if len(backfill) < remaining:
            already_picked |= {q["id"] for q in backfill}
            backfill += get_random_trivia_questions(
                source="opentdb", limit=remaining - len(backfill), exclude_ids=already_picked,
            )
        session += backfill

    mark_trivia_questions_seen(user_id, [q["id"] for q in session])

    random.shuffle(session)
    # Never trust the client with the answer -- same principle as Co-Star's
    # validate_full_chain and Trifecta's score_selection (and the real
    # leaked-answers bug fixed on Co-Star earlier).
    return [{k: v for k, v in q.items() if k != "correct_answer"} for q in session]


def check_answer(question_id: int, answer: str) -> dict:
    q = get_trivia_question_by_id(question_id)
    if not q:
        return {"correct": False, "correct_answer": None}
    return {"correct": answer == q["correct_answer"], "correct_answer": q["correct_answer"]}
