"""Mini-crossword generation feasibility spike (GitHub issue #267).

Builds a 5x5 crossword from a single movie's own data -- cast surnames,
character names, director, genres, keywords -- with no per-question LLM
calls, matching the same constraint used elsewhere in the games work.

No existing Python crossword-grid-generation library was a good fit for this
(checked genxword, crossword-generator, pycrossword-generator -- see PR
description): none of them solve the actual hard part here, which is fitting
a symmetric block-square skeleton to a small, sparse set of short proper
nouns rather than filling a large dictionary-backed grid. So this hardcodes
a handful of known-valid 5x5 skeletons and does a small backtracking fill --
tractable at this scale (<=10 slots, a few dozen candidate words) without
needing heuristics or an external solver.
"""

import json
import re

from filmprint.db import get_connection

GRID_SIZE = 5

# Hand-verified: every open cell in each pattern belongs to a slot of length
# >= 3 in both directions (no orphan cells). 180-degree rotationally symmetric.
GRID_SKELETONS: list[set[tuple[int, int]]] = [
    set(),  # fully open -- five 5-letter across/down slots
    {(0, 0), (0, 4), (4, 0), (4, 4)},  # four corners blocked -- mix of 3s and 5s
    {(0, 4), (4, 0)},  # two corners blocked -- mix of 4s and 5s
    {(0, 0), (4, 4)},  # two corners blocked, other diagonal
]


def _clean_token(token: str) -> str:
    return re.sub(r"[^A-Za-z]", "", token).upper()


def _add_candidate(candidates: dict[str, dict], word: str, clue: str) -> None:
    cleaned = _clean_token(word)
    if 3 <= len(cleaned) <= GRID_SIZE and cleaned not in candidates:
        candidates[cleaned] = {"word": cleaned, "clue": clue}


def _movie_candidate_pairs(
    movie: dict, cast: list[dict], *, include_genre: bool, title_clue: str
) -> list[tuple[str, str]]:
    """Yields (raw_word, clue) pairs for a single movie, in priority order (top-billed
    cast first -- callers relying on a per-movie cap, e.g. genre mode, take the first
    N that pass length filtering/dedup, so order here determines which candidates a
    capped caller actually gets a chance to use)."""
    title, year = movie["title"], movie["year"]
    keywords = json.loads(movie["keywords"]) if movie["keywords"] else []
    genres = json.loads(movie["genres"]) if movie["genres"] else []
    directors = json.loads(movie["director"]) if movie["director"] else []

    pairs: list[tuple[str, str]] = []
    for row in cast:
        name, role = row["person_name"], row["role"]
        if name:
            name_tokens = name.split()
            clue = f"Played {role} in {title} ({year})" if role else f"Actor in {title} ({year})"
            pairs.append((name_tokens[-1], clue))
            if len(name_tokens) > 1:
                first_clue = f"First name of the actor who played {role} in {title} ({year})" if role \
                    else f"First name of an actor in {title} ({year})"
                pairs.append((name_tokens[0], first_clue))
        if role:
            pairs.append((role.split()[0], f"Character in {title}, played by {name}"))
    for d in directors:
        if d:
            d_tokens = d.split()
            pairs.append((d_tokens[-1], f"Director of {title} ({year})"))
            if len(d_tokens) > 1:
                pairs.append((d_tokens[0], f"First name of the director of {title} ({year})"))
    if include_genre:
        for g in genres:
            pairs.append((g, f"A genre of {title}"))
    for kw in keywords:
        pairs.append((kw, f"A theme in {title}"))
    pairs.append((title, title_clue))
    for word in title.split():
        if word.lower() not in ("the", "a", "an", "of", "and", "to", "in"):
            pairs.append((word, f"A word in this puzzle's movie title"))
    return pairs


def _fetch_movie_and_cast(cur, movie_id: int) -> tuple[dict, list[dict]]:
    cur.execute(
        "SELECT id, title, year, keywords, genres, director FROM movies WHERE id = %s",
        (movie_id,),
    )
    movie = cur.fetchone()
    if not movie:
        raise ValueError(f"No movie with id={movie_id}")
    cur.execute(
        "SELECT person_name, role, billing_order FROM movie_credits "
        "WHERE movie_id = %s ORDER BY billing_order",
        (movie_id,),
    )
    return movie, cur.fetchall()


def _candidates_for_movie(movie_id: int) -> tuple[list[dict], dict]:
    """Returns (candidates, movie_info). movie_info carries title/year for clue text."""
    with get_connection() as conn:
        cur = conn.cursor()
        movie, cast = _fetch_movie_and_cast(cur, movie_id)

    candidates: dict[str, dict] = {}
    pairs = _movie_candidate_pairs(
        movie, cast, include_genre=True, title_clue="Title of this puzzle's movie"
    )
    for word, clue in pairs:
        _add_candidate(candidates, word, clue)

    return list(candidates.values()), {"title": movie["title"], "year": movie["year"]}


_GENRE_MOVIE_LIMIT = 15
_GENRE_PER_MOVIE_CAP = 2


def _candidates_for_genre(
    genre: str, movie_limit: int = _GENRE_MOVIE_LIMIT, per_movie_cap: int = _GENRE_PER_MOVIE_CAP
) -> tuple[list[dict], dict]:
    """Returns (candidates, genre_info). Draws from the same curated-pool recognizability
    bar used elsewhere (vote_count >= 1000, revenue > 0) filtered to the given genre, capped
    per movie so no single title dominates the puzzle."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, title, year, keywords, genres, director FROM movies
               WHERE vote_count >= 1000 AND revenue > 0 AND genres ILIKE %s
               ORDER BY vote_count DESC LIMIT %s""",
            (f"%{genre}%", movie_limit),
        )
        movies = cur.fetchall()
        if not movies:
            raise ValueError(f"No curated-pool movies found for genre={genre!r}")

        candidates: dict[str, dict] = {}
        for movie in movies:
            cur.execute(
                "SELECT person_name, role, billing_order FROM movie_credits "
                "WHERE movie_id = %s ORDER BY billing_order",
                (movie["id"],),
            )
            cast = cur.fetchall()
            pairs = _movie_candidate_pairs(
                movie, cast, include_genre=False, title_clue="Title of one of this puzzle's movies"
            )
            added_for_movie = 0
            for word, clue in pairs:
                if added_for_movie >= per_movie_cap:
                    break
                before = len(candidates)
                _add_candidate(candidates, word, clue)
                if len(candidates) > before:
                    added_for_movie += 1

    return list(candidates.values()), {"genre": genre, "movie_count": len(movies)}


def _slots_for_skeleton(blocks: set[tuple[int, int]], size: int = GRID_SIZE) -> list[dict]:
    """Derive across/down slots (contiguous open runs, length >= 3) from a block pattern."""
    slots = []
    for r in range(size):
        c = 0
        while c < size:
            if (r, c) in blocks:
                c += 1
                continue
            start = c
            while c < size and (r, c) not in blocks:
                c += 1
            length = c - start
            if length >= 3:
                slots.append({
                    "dir": "across", "row": r, "col": start, "length": length,
                    "cells": [(r, start + i) for i in range(length)],
                })
    for c in range(size):
        r = 0
        while r < size:
            if (r, c) in blocks:
                r += 1
                continue
            start = r
            while r < size and (r, c) not in blocks:
                r += 1
            length = r - start
            if length >= 3:
                slots.append({
                    "dir": "down", "row": start, "col": c, "length": length,
                    "cells": [(start + i, c) for i in range(length)],
                })
    return slots


_MAX_SEARCH_NODES = 20_000


def _backtrack_fill(slots: list[dict], candidates: list[dict]) -> tuple[dict[int, dict], dict[tuple[int, int], str]]:
    """Finds the best-effort slot->candidate assignment (not necessarily complete --
    returns the deepest fill found rather than failing outright on a partial grid).

    Picks the most-constrained unfilled slot first at each step (minimum-remaining-
    values heuristic), not a static length-sorted order. A static order that ties by
    insertion order (across slots are appended before down slots in
    _slots_for_skeleton) systematically commits every across word before a single
    down slot is even considered -- by the time down slots are attempted, all
    crossing letters are already locked in with no regard for whether any real
    candidate word could ever match them. Choosing dynamically lets a down slot's
    shrinking candidate count steer which across words get tried, instead of
    discovering the mismatch only after every across slot is already filled.

    A flat node budget bounds worst-case runtime deterministically regardless of
    skeleton/candidate-pool shape, at the cost of settling for the best fill found
    so far instead of the true optimum.
    """
    by_length: dict[int, list[dict]] = {}
    for cand in candidates:
        by_length.setdefault(len(cand["word"]), []).append(cand)

    grid: dict[tuple[int, int], str] = {}
    assignment: dict[int, dict] = {}
    used_words: set[str] = set()
    best = {"assignment": {}, "grid": {}}
    nodes_visited = 0
    remaining = set(range(len(slots)))

    def maybe_record_best():
        if len(assignment) > len(best["assignment"]):
            best["assignment"] = dict(assignment)
            best["grid"] = dict(grid)

    def legal_candidates(slot_i: int) -> list[dict]:
        slot = slots[slot_i]
        return [
            cand for cand in by_length.get(slot["length"], [])
            if cand["word"] not in used_words
            and all(grid.get(cell) in (None, letter) for cell, letter in zip(slot["cells"], cand["word"]))
        ]

    def backtrack():
        nonlocal nodes_visited
        nodes_visited += 1
        maybe_record_best()
        if not remaining or len(best["assignment"]) == len(slots) or nodes_visited >= _MAX_SEARCH_NODES:
            return

        slot_i, legal = min(((i, legal_candidates(i)) for i in remaining), key=lambda t: len(t[1]))
        remaining.discard(slot_i)

        if not legal:
            backtrack()  # nothing fits -- leave unfilled, let other slots still get a chance
            remaining.add(slot_i)
            return

        slot = slots[slot_i]
        for cand in legal:
            if nodes_visited >= _MAX_SEARCH_NODES:
                break
            word = cand["word"]
            placed_cells = [cell for cell in slot["cells"] if cell not in grid]
            for cell, letter in zip(slot["cells"], word):
                grid[cell] = letter
            assignment[slot_i] = cand
            used_words.add(word)

            backtrack()

            del assignment[slot_i]
            used_words.discard(word)
            for cell in placed_cells:
                del grid[cell]
        remaining.add(slot_i)

    backtrack()
    return best["assignment"], best["grid"]


def _number_slots(slots: list[dict]) -> None:
    """Standard crossword numbering: each unique starting cell gets the next number in
    reading order, shared between an across and down slot that start at the same cell."""
    starts = sorted({(s["row"], s["col"]) for s in slots})
    numbers = {cell: i + 1 for i, cell in enumerate(starts)}
    for s in slots:
        s["number"] = numbers[(s["row"], s["col"])]


def _build_puzzle(candidates: list[dict], info: dict) -> dict:
    """Shared skeleton-search + backtrack + numbering pipeline for both single-movie
    and genre-pool candidate sources. slots_filled/slots_total is reported honestly --
    this is a feasibility spike, not a guarantee of a fully-solved puzzle."""
    if not candidates:
        raise ValueError("No usable 3-5 letter candidates found")

    best = None
    for skeleton in GRID_SKELETONS:
        slots = _slots_for_skeleton(skeleton)
        assignment, grid = _backtrack_fill(slots, candidates)
        filled = len(assignment)
        if best is None or filled > best["filled"]:
            best = {"skeleton": skeleton, "slots": slots, "assignment": assignment, "grid": grid, "filled": filled}
        if filled == len(slots):
            break

    slots, assignment = best["slots"], best["assignment"]
    _number_slots(slots)

    across, down = [], []
    for i, slot in enumerate(slots):
        cand = assignment.get(i)
        entry = {
            "number": slot["number"],
            "length": slot["length"],
            "clue": cand["clue"] if cand else None,
            "answer": cand["word"] if cand else None,
        }
        (across if slot["dir"] == "across" else down).append(entry)

    return {
        **info,
        "grid_size": GRID_SIZE,
        "blocks": best["skeleton"],
        "grid": best["grid"],
        "across": across,
        "down": down,
        "slots_filled": best["filled"],
        "slots_total": len(slots),
    }


def generate_crossword(movie_id: int) -> dict:
    """Generates the best-effort 5x5 crossword sourced from a single movie's own data.

    Returns {movie, grid_size, blocks, grid, across, down, slots_filled, slots_total}.
    """
    candidates, movie_info = _candidates_for_movie(movie_id)
    return _build_puzzle(candidates, {"movie": movie_info})


def generate_crossword_for_genre(
    genre: str, movie_limit: int = _GENRE_MOVIE_LIMIT, per_movie_cap: int = _GENRE_PER_MOVIE_CAP
) -> dict:
    """Generates the best-effort 5x5 crossword sourced from the top `movie_limit` curated-pool
    movies in `genre` by vote_count, capped at `per_movie_cap` candidate words per movie so no
    single title dominates the puzzle.

    Returns {genre, grid_size, blocks, grid, across, down, slots_filled, slots_total}.
    """
    candidates, genre_info = _candidates_for_genre(genre, movie_limit, per_movie_cap)
    return _build_puzzle(candidates, {"genre": genre_info})


def render_grid(result: dict) -> str:
    size = result["grid_size"]
    blocks, grid = result["blocks"], result["grid"]
    lines = []
    for r in range(size):
        row = [("#" if (r, c) in blocks else grid.get((r, c), ".")) for c in range(size)]
        lines.append(" ".join(row))
    return "\n".join(lines)
