"""CLI entry point — conversational mood Q&A, then tonight's picks."""

import json
import time
import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)
from rich.console import Console
import random
import numpy as np
from filmprint.features import GENRES, taste_summary
from filmprint.recommender import diversify, rank_watchlist

console = Console()

def _genre_names(movie: dict) -> list[str]:
    genres = movie.get("genres") or []
    if isinstance(genres, str):
        genres = json.loads(genres)
    return [g["name"] if isinstance(g, dict) else g for g in genres]


def _call_claude(client: anthropic.Anthropic, **kwargs) -> str:
    """Call Claude with exponential backoff on 529 overloaded errors."""
    retries = 3
    delay = 10
    for attempt in range(retries):
        try:
            response = client.messages.create(**kwargs)
            return response.content[0].text
        except anthropic.APIStatusError as e:
            if e.status_code == 529 and attempt < retries - 1:
                console.print(f"[yellow]API busy, retrying in {delay}s...[/yellow]")
                time.sleep(delay)
                delay *= 2
            else:
                raise


_EMPTY_FILTERS = {"required_genres": [], "exclude_genres": [], "max_runtime": None}

_OPENING_ANGLES = [
    "energy level — something intense and gripping vs low-key and easy",
    "mood or tone — light/escapist vs dark/heavy vs somewhere in between",
    "one of their less-obvious genres — look past the dominant ones and ask about Horror, Sci-Fi, War, or whatever sits lower in their profile",
    "pacing and atmosphere — slow-burn and atmospheric vs tight and fast-moving",
    "time period or setting — contemporary, period piece, world cinema, a specific decade they might be feeling",
    "what kind of experience they want — something safe and familiar vs challenging and unexpected",
    "who they're watching with, and what kind of film works for that context",
]


def gather_mood_context(client: anthropic.Anthropic, taste_summary: str) -> tuple[str, dict]:
    MAX_QUESTIONS = 6   # hard cap on total questions asked
    MIN_MEANINGFUL = 2  # real answers needed before Claude can conclude
    opening_angle = random.choice(_OPENING_ANGLES)

    system = f"""You are a knowledgeable film friend helping someone pick what to watch tonight.

Their taste profile (strongest signals from their ratings):
{taste_summary}

Your job: ask multiple-choice questions (up to {MAX_QUESTIONS} total) to understand their mood. Each response must be valid JSON in exactly one of these two formats:

If asking a question:
{{"done": false, "question": "...", "options": ["...", "...", "..."]}}

After 2-3 real answers (not "None of these"), conclude. 2 good answers is usually enough — do not keep asking:
{{"done": true, "summary": "...", "required_genres": [], "exclude_genres": [], "max_runtime": null}}

Rules:
- Exactly 3 options per question
- Ask 2-3 questions then conclude. Never ask more than 4.
- Make questions specific to their taste — reference genres or styles they actually like
- Do NOT reference or quote taste profile labels in your questions (do not say things like "2010s is a sweet spot for you" or mention runtime buckets)
- Each follow-up should drill deeper into their previous answer, not jump to a new topic
- Your first question must focus on: {opening_angle}
- The summary should capture: mood/tone, anything to avoid
- For required_genres and exclude_genres, use exact names from this list only: {", ".join(GENRES)}
- For required_genres: only include genres clearly implied by their answers. If answers point to mood/intensity rather than a specific genre, leave required_genres empty — do not list broad genres like Drama that would barely filter anything
- For required_genres, map adjacent concepts: espionage → Thriller, space/sci-fi → Science Fiction, heist → Crime
- For exclude_genres, ONLY include genres the user explicitly named. NEVER infer genre exclusions from pacing or tone
- max_runtime: integer minutes if they explicitly said they want something short, null otherwise
- If the user chose "None of these", your next question must take a completely different angle — different genre territory, different framing entirely
- Output ONLY valid JSON, no commentary"""

    messages = [{"role": "user", "content": "What should I watch tonight?"}]
    qa_history = []
    meaningful_count = 0
    console.print()

    for _ in range(MAX_QUESTIONS):
        reply = _call_claude(
            client,
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system=system,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": reply})

        try:
            parsed = json.loads(reply)
        except json.JSONDecodeError:
            stripped = reply.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                return reply.strip(), _EMPTY_FILTERS

        if parsed.get("done"):
            if meaningful_count >= MIN_MEANINGFUL:
                filters = {
                    "required_genres": parsed.get("required_genres") or [],
                    "exclude_genres": parsed.get("exclude_genres") or [],
                    "max_runtime": parsed.get("max_runtime"),
                }
                return parsed["summary"], filters
            # Not enough real answers yet — push Claude to keep going
            messages.append({"role": "user", "content": "You need at least 2 real answers before concluding. Ask another question now using the question JSON format."})
            continue

        question = parsed["question"]
        options = parsed["options"]

        console.print(f"[cyan]{question}[/cyan]\n")
        for i, opt in enumerate(options, 1):
            console.print(f"  [dim]{i}.[/dim] {opt}")
        console.print(f"  [dim]0.[/dim] None of these\n")

        valid = {str(i) for i in range(len(options) + 1)}
        while True:
            choice = input("> ").strip()
            if choice in valid:
                break
            console.print(f"[yellow]Enter 1-{len(options)} or 0[/yellow]")

        chosen = options[int(choice) - 1] if choice != "0" else "None of these"
        if choice != "0":
            meaningful_count += 1
        qa_history.append((question, chosen))
        messages.append({"role": "user", "content": chosen})

    # Hit the cap — request final summary
    messages.append({"role": "user", "content": "That's all the questions. Please provide your summary now."})
    reply = _call_claude(
        client,
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=system,
        messages=messages,
    )
    try:
        parsed = json.loads(reply)
        filters = {
            "required_genres": parsed.get("required_genres") or [],
            "exclude_genres": parsed.get("exclude_genres") or [],
            "max_runtime": parsed.get("max_runtime"),
        }
        return parsed.get("summary", reply.strip()), filters
    except json.JSONDecodeError:
        return reply.strip(), _EMPTY_FILTERS


def select_cluster(
    clusters: list,
    filters: dict,
) -> "np.ndarray | None":
    """
    Pick the cluster profile whose genre weights best match the mood's required
    genres. Returns None if there are no clusters or no genre preference, so
    the caller falls back to the blended profile.
    """
    required = filters.get("required_genres") or []
    if not clusters or not required:
        return None

    genre_indices = [GENRES.index(g) for g in required if g in GENRES]
    if not genre_indices:
        return None

    return max(clusters, key=lambda c: sum(c[i] for i in genre_indices))


# Genres that are structurally incompatible with serious/adult film moods.
# Excluded automatically when required_genres contains any "serious" genre,
# unless the user explicitly requested them.
_LIGHTWEIGHT_GENRES = {"Animation", "Family", "Documentary", "Music", "Western", "Romance"}
_SERIOUS_GENRES = {"Thriller", "Crime", "Drama", "Horror", "Mystery", "War", "History", "Science Fiction", "Action", "Adventure"}


def apply_mood_filters(
    ranked: list[tuple[dict, float]],
    filters: dict,
) -> list[tuple[dict, float]]:
    """Hard-filter ranked candidates by mood constraints before Claude reasoning."""
    required = filters.get("required_genres") or []
    excluded = set(filters.get("exclude_genres") or [])
    max_runtime = filters.get("max_runtime")

    # Auto-exclude genres that are structurally incompatible with the requested mood.
    # Only kicks in when at least one serious genre is required and the user hasn't
    # explicitly asked for any lightweight genres.
    if any(g in _SERIOUS_GENRES for g in required):
        implicit_excludes = _LIGHTWEIGHT_GENRES - set(required) - excluded
        excluded = excluded | implicit_excludes

    def passes(movie: dict) -> bool:
        genres = _genre_names(movie)
        if required and not any(g in genres for g in required):
            return False
        if excluded and any(g in genres for g in excluded):
            return False
        if max_runtime:
            runtime = movie.get("runtime")
            if runtime and runtime > max_runtime:
                return False
        return True

    active = []
    if required:
        active.append(f"genres: {', '.join(required)}")
    if excluded:
        active.append(f"exclude: {', '.join(sorted(excluded))}")
    if max_runtime:
        active.append(f"max runtime: {max_runtime}min")
    if active:
        console.print(f"[dim]Filters: {' | '.join(active)}[/dim]")
    else:
        console.print("[dim]No hard filters extracted from mood[/dim]")

    filtered = [(m, s) for m, s in ranked if passes(m)]

    if not filtered:
        console.print(f"[dim]No candidates matched filters — falling back to full list ({len(ranked)} candidates)[/dim]")
        return ranked

    console.print(f"[dim]{len(filtered)} of {len(ranked)} candidates match your mood[/dim]")
    return filtered


def explain_recommendations(
    client: anthropic.Anthropic,
    top_movies: list[tuple[dict, float]],
    mood_summary: str,
    active_taste_summary: str,
    watchlist_ids: set[int],
) -> list[dict]:
    """
    Ask Claude to pick tonight's best films and return structured picks.
    Each pick: {id, title, year, source, reason}
    """
    candidates = top_movies[:20]
    movie_list = "\n".join(
        "[{idx}] {source} {title} ({year}) — taste score: {score:.2f} | genres: {genres} | runtime: {runtime}min | TMDB rating: {rating}".format(
            idx=i,
            source="watchlist" if m["id"] in watchlist_ids else "discovered",
            title=m["title"],
            year=m.get("year") or (m.get("release_date", "") or "")[:4],
            score=score,
            genres=", ".join(_genre_names(m)),
            runtime=m.get("runtime") or "?",
            rating=m.get("vote_average", "?"),
        )
        for i, (m, score) in enumerate(candidates)
    )

    prompt = f"""You are a knowledgeable film friend giving honest, specific recommendations based on what you know about the person's taste.

The user's taste profile (used for ranking only — do not quote these labels or treat them as stated preferences):
{active_taste_summary}

What they actually said tonight:
{mood_summary}

Candidates (indexed for your response):
{movie_list}

Pick the 3-5 best films for tonight. Use real judgment — a discovered film that perfectly fits tonight's mood might beat a higher-scored watchlist film.

Return ONLY a JSON array, no other text:
[
  {{"idx": 0, "reason": "one or two sentences — specific to this film and tonight's mood"}},
  ...
]

For each reason:
- Ground it in what you actually know about the film (genre, tone, style, themes)
- Reference what they explicitly said tonight
- Do NOT reference taste profile labels or invent preferences they didn't mention"""

    reply = _call_claude(
        client,
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        raw = json.loads(reply)
    except json.JSONDecodeError:
        # Strip markdown code fences if present
        stripped = reply.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        raw = json.loads(stripped)

    picks = []
    for item in raw:
        idx = item["idx"]
        if idx >= len(candidates):
            continue
        movie, score = candidates[idx]
        picks.append({
            "id": movie["id"],
            "title": movie["title"],
            "year": movie.get("year") or (movie.get("release_date", "") or "")[:4],
            "source": "watchlist" if movie["id"] in watchlist_ids else "discovered",
            "score": score,
            "reason": item["reason"],
        })
    return picks


def run(rated_movies, ratings, ranked, blended_summary, watchlist_ids,
        keyword_vocab=None, affinity=None, clusters=None, user_id=None):
    client = anthropic.Anthropic()

    console.print("\n[bold]Let's figure out what to watch tonight.[/bold]")
    mood_summary, filters = gather_mood_context(client, blended_summary)

    cluster = select_cluster(clusters or [], filters)
    if cluster is not None:
        console.print("[dim]Using mood-matched taste cluster for ranking[/dim]")
        all_candidates = [m for m, _ in ranked]
        ranked = rank_watchlist(cluster, all_candidates, keyword_vocab, affinity)
        active_summary = taste_summary(cluster, keyword_vocab)
    else:
        active_summary = blended_summary

    filtered_ranked = apply_mood_filters(ranked, filters)
    diverse_ranked = diversify(filtered_ranked, ranked, keyword_vocab, affinity)

    console.print("\n[bold]Finding your best picks...[/bold]\n")
    picks = explain_recommendations(client, diverse_ranked, mood_summary, active_summary, watchlist_ids)

    # Render picks
    for pick in picks:
        source_tag = r"[dim]\[watchlist][/dim]" if pick["source"] == "watchlist" else r"[dim]\[discovered][/dim]"
        console.print(f"[bold]{pick['title']}[/bold] ({pick['year']}) {source_tag}")
        console.print(f"{pick['reason']}\n")

    # Log to recommendation history
    if user_id is not None:
        from filmprint.db import log_recommendation
        mood_context = {"summary": mood_summary, "filters": filters}
        for pick in picks:
            log_recommendation(user_id, pick["id"], pick["score"], mood_context)
