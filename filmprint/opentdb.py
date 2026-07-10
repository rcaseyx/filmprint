"""Open Trivia DB (opentdb.com) client -- general film trivia questions.

No API key required. Category 11 = "Entertainment: Film". Restricted to
type=multiple so every question has exactly 4 options (no true/false mixed
in). We cache fetched questions in our own trivia_questions table rather than
live-fetching per game session -- OTDB has a hard 5-second-per-IP rate limit
and only ~300 questions in this category total, neither of which suits
per-request live calls.
"""

import html

import requests

BASE_URL = "https://opentdb.com/api.php"
FILM_CATEGORY = 11


def fetch_film_questions(amount: int = 50, difficulty: str | None = None) -> list[dict]:
    """Returns up to `amount` questions as {question_text, correct_answer, options,
    difficulty}. Returns an empty list once OTDB has no more questions to give for
    this query (response_code != 0) -- that's how the backfill script knows to stop.

    difficulty ('easy'/'medium'/'hard') is passed straight through to OTDB's own
    query param when given -- filtering at the source rather than fetching everything
    and discarding some of it after the fact, since OTDB's "easy" tier reads
    noticeably weaker/less interesting than medium/hard for this game."""
    params = {"amount": amount, "category": FILM_CATEGORY, "type": "multiple"}
    if difficulty:
        params["difficulty"] = difficulty
    response = requests.get(BASE_URL, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()
    if data.get("response_code") != 0:
        return []

    questions = []
    for q in data["results"]:
        options = [q["correct_answer"]] + q["incorrect_answers"]
        questions.append({
            "question_text": html.unescape(q["question"]),
            "correct_answer": html.unescape(q["correct_answer"]),
            "options": [html.unescape(o) for o in options],
            "difficulty": q.get("difficulty"),
        })
    return questions
