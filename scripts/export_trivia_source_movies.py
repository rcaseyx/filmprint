"""
Exports the most prominent movies in the catalog to a CSV, for feeding into a
separate Claude session to hand-write trivia questions from (see the prompt
in scripts/trivia_question_prompt.md). This is a one-way data dump -- no
Anthropic API calls happen here or anywhere in the app; question generation
is a manual, out-of-band step, and scripts/import_claude_trivia_questions.py
is the other half of the round trip once that session's output comes back.

Same recognizability floor as Focus Pull (vote_count >= 5000, revenue > 0) --
trivia questions about obscure movies are exactly as bad an experience as an
unrecognizable poster.

Usage:
    python scripts/export_trivia_source_movies.py [--limit N]
"""

import argparse
import csv
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import get_connection

MIN_VOTES = 5000
DEFAULT_LIMIT = 250
OUTPUT_PATH = Path(__file__).parent.parent / "data" / "trivia_source_movies.csv"

FIELDNAMES = [
    "movie_id", "title", "year", "runtime", "genres", "keywords", "director",
    "top_cast", "tagline", "overview", "vote_average", "imdb_score", "rt_score",
    "mc_score", "revenue",
]


def _fetch_movies(limit: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, title, year, runtime, genres, keywords, director, raw_tmdb,
                      vote_average, imdb_score, rt_score, mc_score, revenue
               FROM movies
               WHERE vote_count >= %s AND revenue > 0
               ORDER BY vote_count DESC
               LIMIT %s""",
            (MIN_VOTES, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def _fetch_top_cast(movie_ids: list[int], per_movie: int = 5) -> dict[int, list[dict]]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT movie_id, person_name, role FROM movie_credits
               WHERE movie_id = ANY(%s)
               ORDER BY movie_id, billing_order""",
            (movie_ids,),
        )
        rows = cur.fetchall()
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["movie_id"], []).append(dict(row))
    return {mid: cast[:per_movie] for mid, cast in grouped.items()}


def _format_cast(cast: list[dict]) -> str:
    return "; ".join(f"{c['person_name']} as {c['role']}" if c["role"] else c["person_name"] for c in cast)


def _join(value: str | None) -> str:
    if not value:
        return ""
    try:
        items = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value
    return "; ".join(items) if isinstance(items, list) else str(items)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    movies = _fetch_movies(args.limit)
    if not movies:
        print("No movies matched the pool filter -- is DATABASE_URL pointed at a populated DB?")
        sys.exit(1)

    cast_by_movie = _fetch_top_cast([m["id"] for m in movies])

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for m in movies:
            raw = json.loads(m["raw_tmdb"]) if m.get("raw_tmdb") else {}
            writer.writerow({
                "movie_id": m["id"],
                "title": m["title"],
                "year": m["year"],
                "runtime": m["runtime"],
                "genres": _join(m["genres"]),
                "keywords": _join(m["keywords"]),
                "director": _join(m["director"]),
                "top_cast": _format_cast(cast_by_movie.get(m["id"], [])),
                "tagline": raw.get("tagline") or "",
                "overview": raw.get("overview") or "",
                "vote_average": m["vote_average"],
                "imdb_score": m["imdb_score"] or "",
                "rt_score": m["rt_score"] or "",
                "mc_score": m["mc_score"] or "",
                "revenue": m["revenue"],
            })

    print(f"Wrote {len(movies)} movies to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
