"""Trivia: merged taste-graph + Open Trivia DB game.

Taste-graph questions are generated from a user's own rated movies and
cached per-movie (not per-user) -- a movie's question bank is generated once,
lazily, on first need, and reused by every subsequent user who has rated it.
Distractors come from movies close in embedding space to the source movie
(the same feature_vector space already built for recommendations), which is
what makes multiple choice actually test knowledge instead of being
guessable by vibe alone.

General (unscoped) Open Trivia DB questions fill out the rest of a session --
no "scope to movies you've seen" matching (OTDB questions are free text, not
movie-ID-keyed, so that matching would be fragile). No hard rated-count
threshold either: a session pulls as many taste-graph questions as the
user's ratings support and backfills the rest from OTDB.
"""

import json
import random
from collections import Counter

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from filmprint.app import ensure_feature_vectors
from filmprint.db import (
    get_connection, get_movie, get_curated_pool_with_vectors, get_user_ratings,
    get_trivia_questions_for_movie, insert_trivia_questions,
    get_random_trivia_questions, get_trivia_question_by_id,
)
from filmprint.features import build_feature_vector

NEIGHBOR_K = 15
SESSION_SIZE_DEFAULT = 12

BOX_OFFICE_BUCKETS = [
    (0, 10_000_000, "Under $10 million"),
    (10_000_000, 50_000_000, "$10-50 million"),
    (50_000_000, 200_000_000, "$50-200 million"),
    (200_000_000, float("inf"), "$200 million+"),
]

_pool_cache: dict[int, dict] | None = None


def _load_pool() -> dict[int, dict]:
    """Module-level cache of the curated pool + vectors, built once per process.

    build_feature_vector()'s output dimensionality depends on the keyword_vocab/
    subgenre_axes it was built with -- most movies were vectorized with the shared
    default (no extra args, same as ensure_feature_vectors() uses), but some got
    cached back with a user-specific keyword_vocab from a recommendation request at
    some point, leaving a handful of inconsistent lengths in movies.feature_vector.
    Keep only the dominant length so cosine_similarity's matrix stacking doesn't
    break on a shape mismatch -- confirmed against production this is ~75% of the
    curated pool (2,502/3,315), still plenty of neighbor-search space.
    """
    global _pool_cache
    if _pool_cache is None:
        movies = get_curated_pool_with_vectors()
        lengths = Counter(len(m["feature_vector"]) for m in movies)
        dominant_length = lengths.most_common(1)[0][0]
        _pool_cache = {
            m["id"]: m for m in movies if len(m["feature_vector"]) == dominant_length
        }
    return _pool_cache


def _seed_vector(movie: dict, expected_length: int) -> np.ndarray | None:
    """The seed movie's own cached vector might be one of the mismatched-dimension
    ones _load_pool() filtered out of the pool (see its docstring). Recompute fresh
    with the shared default args in that case -- in-memory only, not persisted back,
    since silently rewriting movies.feature_vector as a side effect of trivia
    question generation could affect the recommendation engine, out of scope here."""
    vec = movie.get("feature_vector")
    if vec and len(vec) == expected_length:
        return np.array(vec)
    raw = movie.get("raw_tmdb")
    if not raw:
        return None
    fresh = build_feature_vector(raw)
    return fresh if len(fresh) == expected_length else None


def _nearest_movies(movie: dict, k: int = NEIGHBOR_K, exclude_ids: set[int] = frozenset()) -> list[dict]:
    pool = _load_pool()
    candidates = [m for mid, m in pool.items() if mid != movie["id"] and mid not in exclude_ids]
    if not candidates:
        return []
    expected_length = len(next(iter(pool.values()))["feature_vector"])
    seed = _seed_vector(movie, expected_length)
    if seed is None:
        return []
    matrix = np.array([m["feature_vector"] for m in candidates])
    sims = cosine_similarity(seed.reshape(1, -1), matrix)[0]
    ranked = sorted(zip(candidates, sims), key=lambda pair: -pair[1])
    return [m for m, _ in ranked[:k]]


def _get_cast_batch(movie_ids: list[int], limit_per_movie: int = 10) -> dict[int, list[dict]]:
    """Top-billed cast for multiple movies in a single round trip, grouped by movie_id.
    Generating one movie's question bank touches its own cast plus up to NEIGHBOR_K
    neighbors' -- fetching those individually (as an earlier version of this code did)
    meant 15+ separate DB round trips per bank, ~20s of Railway-proxy network latency
    per movie. Batching this into one query cut a cold-start session build from
    ~20-25s to well under a second."""
    if not movie_ids:
        return {}
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT movie_id, person_id, person_name, role, billing_order, profile_path
               FROM movie_credits WHERE movie_id = ANY(%s)
               ORDER BY movie_id, billing_order""",
            (movie_ids,),
        )
        rows = cur.fetchall()
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["movie_id"], []).append(dict(row))
    return {mid: cast[:limit_per_movie] for mid, cast in grouped.items()}


def _movie_label(movie: dict) -> str:
    year = movie.get("year")
    return f"{movie['title']} ({year})" if year else movie["title"]


def _pick_distractors(values: list[str], correct: str, count: int = 3) -> list[str] | None:
    """Dedupe against the correct answer and each other. None if not enough distinct values found."""
    seen = {correct}
    distractors = []
    for v in values:
        if v and v not in seen:
            seen.add(v)
            distractors.append(v)
        if len(distractors) == count:
            break
    return distractors if len(distractors) == count else None


def _finalize(question_type: str, movie: dict, question_text: str, correct: str,
              distractors: list[str], image_url: str | None = None) -> dict:
    options = [correct] + distractors
    random.shuffle(options)
    return {
        "movie_id": movie["id"],
        "source": "generated",
        "question_type": question_type,
        "question_text": question_text,
        "correct_answer": correct,
        "options": options,
        "image_url": image_url,
    }


def _director_question(movie: dict, neighbors: list[dict], cast_by_movie: dict[int, list[dict]]) -> dict | None:
    directors = json.loads(movie["director"]) if movie.get("director") else []
    if not directors:
        return None
    correct = directors[0]
    neighbor_directors = []
    for n in neighbors:
        ds = json.loads(n["director"]) if n.get("director") else []
        if ds:
            neighbor_directors.append(ds[0])
    distractors = _pick_distractors(neighbor_directors, correct)
    if not distractors:
        return None
    return _finalize(
        "director", movie, f"Who directed {_movie_label(movie)}?", correct, distractors,
    )


def _character_question(movie: dict, neighbors: list[dict], cast_by_movie: dict[int, list[dict]]) -> dict | None:
    cast = [c for c in cast_by_movie.get(movie["id"], [])[:5] if c["role"]]
    if not cast:
        return None
    pick = cast[0]
    correct = pick["role"]

    neighbor_roles = []
    for n in neighbors:
        for c in cast_by_movie.get(n["id"], [])[:3]:
            if c["role"]:
                neighbor_roles.append(c["role"])
    distractors = _pick_distractors(neighbor_roles, correct)
    if not distractors:
        return None
    return _finalize(
        "character", movie,
        f"What's {pick['person_name']}'s character called in {_movie_label(movie)}?",
        correct, distractors,
    )


def _year_question(movie: dict, neighbors: list[dict], cast_by_movie: dict[int, list[dict]]) -> dict | None:
    if not movie.get("year"):
        return None
    correct = str(movie["year"])
    neighbor_years = [str(n["year"]) for n in neighbors if n.get("year")]
    distractors = _pick_distractors(neighbor_years, correct)
    if not distractors:
        return None
    return _finalize(
        "year", movie, f"What year was {movie['title']} released?", correct, distractors,
    )


def _tagline_question(movie: dict, neighbors: list[dict], cast_by_movie: dict[int, list[dict]]) -> dict | None:
    tagline = (movie.get("raw_tmdb") or {}).get("tagline")
    if not tagline:
        return None
    correct = movie["title"]
    distractors = _pick_distractors([n["title"] for n in neighbors], correct)
    if not distractors:
        return None
    return _finalize(
        "tagline", movie, f'Which movie has the tagline: "{tagline}"?', correct, distractors,
    )


def _box_office_bucket(revenue: int) -> str | None:
    for low, high, label in BOX_OFFICE_BUCKETS:
        if low <= revenue < high:
            return label
    return None


def _box_office_question(movie: dict, neighbors: list[dict], cast_by_movie: dict[int, list[dict]]) -> dict | None:
    revenue = movie.get("revenue")
    if not revenue:
        return None
    correct = _box_office_bucket(revenue)
    if not correct:
        return None
    distractors = [label for _, _, label in BOX_OFFICE_BUCKETS if label != correct]
    return _finalize(
        "box_office", movie,
        f"Roughly how much did {_movie_label(movie)} gross at the box office?",
        correct, distractors,
    )


def _headshot_question(movie: dict, neighbors: list[dict], cast_by_movie: dict[int, list[dict]]) -> dict | None:
    cast = [c for c in cast_by_movie.get(movie["id"], [])[:5] if c["profile_path"]]
    if not cast:
        return None
    pick = cast[0]
    correct = movie["title"]

    distractor_titles = []
    for n in neighbors:
        # Skip any neighbor this same actor is also credited in, to avoid an
        # accidentally-also-correct distractor.
        neighbor_person_ids = {c["person_id"] for c in cast_by_movie.get(n["id"], [])}
        if pick["person_id"] not in neighbor_person_ids:
            distractor_titles.append(n["title"])
    distractors = _pick_distractors(distractor_titles, correct)
    if not distractors:
        return None
    return _finalize(
        "headshot", movie,
        "Which movie did this actor appear in?",
        correct, distractors, image_url=pick["profile_path"],
    )


_GENERATORS = [
    _director_question, _character_question, _year_question,
    _tagline_question, _box_office_question, _headshot_question,
]


def get_or_generate_question_bank(movie_id: int) -> list[dict]:
    existing = get_trivia_questions_for_movie(movie_id)
    if existing:
        return existing

    movie = get_movie(movie_id)
    if not movie:
        return []
    if not movie.get("feature_vector"):
        movie = ensure_feature_vectors([movie])[0]
    if not movie.get("feature_vector"):
        return []  # still missing -- movie has no raw_tmdb data to build one from

    neighbors = _nearest_movies(movie)
    cast_by_movie = _get_cast_batch([movie["id"]] + [n["id"] for n in neighbors])
    questions = [
        q for q in (gen(movie, neighbors, cast_by_movie) for gen in _GENERATORS) if q is not None
    ]
    if not questions:
        return []
    insert_trivia_questions(questions)
    # insert_trivia_questions() doesn't return DB-assigned ids -- re-fetch so the
    # caller (and ultimately the frontend, via build_session) gets real ids to
    # submit back through /trivia/answer, not the pre-insert in-memory dicts.
    return get_trivia_questions_for_movie(movie_id)


def warm_pool() -> None:
    """Loads the embedding-neighbor pool eagerly (~6-7s) rather than on the first real
    request -- called from api/main.py's startup prewarm, same pattern as the ONNX
    model / IDF weights warmup, so no live trivia request ever pays this cost."""
    _load_pool()


def build_session(user_id: int, count: int = SESSION_SIZE_DEFAULT) -> list[dict]:
    """Half taste-graph (as many as the user's ratings support), half OTDB, no hard threshold."""
    rated_ids = [r["id"] for r in get_user_ratings(user_id)]
    random.shuffle(rated_ids)

    taste_target = count // 2
    taste: list[dict] = []
    for movie_id in rated_ids:
        taste.extend(get_or_generate_question_bank(movie_id))
        if len(taste) >= taste_target * 2:  # oversample before trimming, for variety
            break
    random.shuffle(taste)
    taste = taste[:taste_target]

    otdb_target = count - len(taste)  # shortfall from a thin taste pool backfills from OTDB
    otdb = get_random_trivia_questions(source="opentdb", limit=otdb_target)

    session = taste + otdb
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
