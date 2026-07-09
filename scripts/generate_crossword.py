"""
Feasibility spike for GitHub issue #267: generate a 5x5 mini crossword, either
from a single movie's own data (cast, character names, director, genres,
keywords) or pooled across the top curated-pool movies in a genre (spreading
candidates across several titles instead of leaning on just one). No
per-question LLM calls. Standalone and read-only -- no schema or frontend
commitment yet, just proving out the generation approach.

Usage:
    python scripts/generate_crossword.py --movie-id 27205
    python scripts/generate_crossword.py --title "Inception"
    python scripts/generate_crossword.py --genre Horror
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

from filmprint.db import init_db, get_connection
from filmprint.crossword import generate_crossword, generate_crossword_for_genre, render_grid


def _resolve_movie_id(args: argparse.Namespace) -> int:
    if args.movie_id:
        return args.movie_id
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM movies WHERE title ILIKE %s ORDER BY vote_count DESC LIMIT 1",
            (args.title,),
        )
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"No movie found matching title={args.title!r}")
        return row["id"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--movie-id", type=int)
    parser.add_argument("--title", type=str)
    parser.add_argument("--genre", type=str, help="e.g. Horror, Comedy, Action")
    parser.add_argument("--movie-limit", type=int, default=15, help="genre mode only")
    parser.add_argument("--per-movie-cap", type=int, default=2, help="genre mode only")
    args = parser.parse_args()
    if not args.movie_id and not args.title and not args.genre:
        raise SystemExit("Provide --movie-id, --title, or --genre")

    init_db()
    if args.genre:
        result = generate_crossword_for_genre(args.genre, args.movie_limit, args.per_movie_cap)
        print(f"\nGenre: {result['genre']['genre']} (from {result['genre']['movie_count']} movies)")
    else:
        movie_id = _resolve_movie_id(args)
        result = generate_crossword(movie_id)
        print(f"\n{result['movie']['title']} ({result['movie']['year']})")
    print(f"Slots filled: {result['slots_filled']}/{result['slots_total']}\n")
    print(render_grid(result))

    print("\nAcross:")
    for slot in sorted(result["across"], key=lambda s: s["number"]):
        label = f"{slot['answer']} ({slot['length']})" if slot["answer"] else f"(unfilled, {slot['length']} letters)"
        clue = slot["clue"] or "no candidate word fit this slot"
        print(f"  {slot['number']}. {clue} — {label}")

    print("\nDown:")
    for slot in sorted(result["down"], key=lambda s: s["number"]):
        label = f"{slot['answer']} ({slot['length']})" if slot["answer"] else f"(unfilled, {slot['length']} letters)"
        clue = slot["clue"] or "no candidate word fit this slot"
        print(f"  {slot['number']}. {clue} — {label}")


if __name__ == "__main__":
    main()
