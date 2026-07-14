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
import re

from filmprint.db import (
    get_movies_by_ids, get_random_trivia_questions, get_trivia_question_by_id,
    get_user_seen_trivia_question_ids, mark_trivia_questions_seen,
)

SESSION_SIZE_DEFAULT = 10
# Mostly Claude-authored (the richer, hand-written pool) with a small OTDB
# slice for variety/breadth beyond the 250-movie Claude set.
CLAUDE_TARGET = 8


def _title_reveals_answer(correct_answer: str, movie_title: str) -> bool:
    """True if showing movie_title alongside the question would give away
    correct_answer -- either it's a straight "guess the movie" question (the
    title IS the answer) or a fill-in-the-blank whose blank is a fragment
    lifted straight from the title (e.g. correct_answer='Django' for the
    movie 'Django Unchained', or 'Azkaban' for 'Harry Potter and the
    Prisoner of Azkaban'). Word-boundary match rather than plain substring so
    short answers don't false-positive on titles that merely contain the same
    letters (e.g. 'man' shouldn't match inside 'Kingsman')."""
    answer_norm = correct_answer.strip().lower()
    title_norm = movie_title.strip().lower()
    if answer_norm == title_norm:
        return True
    return re.search(rf"\b{re.escape(answer_norm)}\b", title_norm) is not None


def _attach_movie_context(session: list[dict]) -> None:
    """Claude questions always carry a real movie_id (unlike OTDB rows, whose
    movie_id is NULL) but many never name the movie anywhere in question_text
    -- unanswerable without it. Attach movie_title in place so the UI can show
    it, except where doing so would leak the answer (see
    _title_reveals_answer). Mutates each question dict in session."""
    movie_ids = {q["movie_id"] for q in session if q.get("movie_id")}
    if not movie_ids:
        return
    movies = get_movies_by_ids(list(movie_ids))
    for q in session:
        movie = movies.get(q.get("movie_id"))
        if movie and not _title_reveals_answer(q["correct_answer"], movie["title"]):
            q["movie_title"] = movie["title"]


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

    _attach_movie_context(session)

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
