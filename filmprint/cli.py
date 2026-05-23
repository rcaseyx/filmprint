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
    MAX_QUESTIONS = 8   # hard cap on total questions asked
    MIN_MEANINGFUL = 2  # real answers needed before Claude can conclude
    opening_angle = random.choice(_OPENING_ANGLES)

    system = f"""You are a knowledgeable film friend helping someone pick what to watch tonight.

Their taste profile (strongest signals from their ratings):
{taste_summary}

Your job: ask multiple-choice questions (up to {MAX_QUESTIONS} total) to understand their mood. Each response must be valid JSON in exactly one of these two formats:

If asking a question:
{{"done": false, "question": "...", "options": ["...", "...", "..."]}}

If you have enough context (exit as early as you can — 2-3 good answers is usually plenty):
{{"done": true, "summary": "...", "required_genres": [], "exclude_genres": [], "max_runtime": null}}

Rules:
- Exactly 3 options per question
- Make questions specific to their taste — reference genres or styles they actually like
- Each follow-up should drill deeper into their previous answer, not jump to a new topic
- Your first question must focus on: {opening_angle}
- The summary should capture: mood/tone, anything to avoid
- For required_genres and exclude_genres, use exact names from this list only: {", ".join(GENRES)}
- For required_genres, map adjacent concepts: espionage → Thriller, space/sci-fi → Science Fiction, heist → Crime
- For exclude_genres, ONLY include genres the user explicitly named (e.g. "no horror", "nothing scary"). NEVER infer genre exclusions from pacing or tone — "nothing slow" does NOT mean exclude Horror or Drama
- max_runtime: integer minutes if they explicitly said they want something short, null otherwise
- If the user chose "None of these" for a question, your next question must take a completely different angle — different genre territory, different framing entirely. Do not rephrase the same options
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
            messages.append({"role": "user", "content": "Keep going — ask another question."})
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


def apply_mood_filters(
    ranked: list[tuple[dict, float]],
    filters: dict,
) -> list[tuple[dict, float]]:
    """Hard-filter ranked candidates by mood constraints before Claude reasoning."""
    required = filters.get("required_genres") or []
    excluded = filters.get("exclude_genres") or []
    max_runtime = filters.get("max_runtime")

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
        active.append(f"exclude: {', '.join(excluded)}")
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
    taste_summary: str,
    watchlist_ids: set[int],
) -> str:
    """Ask Claude to reason over the top candidates and pick tonight's best films."""
    movie_list = "\n".join(
        "{source} {title} ({year}) — taste score: {score:.2f} | genres: {genres} | runtime: {runtime}min | TMDB rating: {rating}".format(
            source="[watchlist]" if m["id"] in watchlist_ids else "[discovered]",
            title=m["title"],
            year=m.get("year") or (m.get("release_date", "") or "")[:4],
            score=score,
            genres=", ".join(_genre_names(m)),
            runtime=m.get("runtime") or "?",
            rating=m.get("vote_average", "?"),
        )
        for m, score in top_movies[:20]
    )

    prompt = f"""You are a knowledgeable film friend — someone who watches a lot of movies and gives honest, specific recommendations based on what you actually know about the person's taste.

The user's taste profile (used for ranking only — do not quote these labels or treat them as stated preferences):
{taste_summary}

What they actually said tonight:
{mood_summary}

Top candidates ranked by taste-profile match. [watchlist] = films they already wanted to see, [discovered] = surfaced based on similarity to films they've loved:
{movie_list}

Pick the 3-5 best films for tonight. Don't just list the highest-scored ones — use real judgment. A discovered film that perfectly fits tonight's mood might beat a watchlist film with a slightly higher score.

For each pick, your reason must be grounded in:
1. What you actually know about the film (genre, tone, style, themes)
2. What they explicitly said tonight

Do NOT reference taste profile labels. Do NOT infer or invent preferences they didn't mention (e.g. runtime, decade). Be concise and direct — like a friend texting a recommendation, not writing a review."""

    return _call_claude(
        client,
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )


def run(rated_movies, ratings, ranked, blended_summary, watchlist_ids,
        keyword_vocab=None, affinity=None, clusters=None):
    client = anthropic.Anthropic()

    console.print("\n[bold]Let's figure out what to watch tonight.[/bold]")
    mood_summary, filters = gather_mood_context(client, blended_summary)

    # Select the cluster whose genre profile best matches tonight's mood.
    # If no clear genre preference, fall back to the blended profile ranking.
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
    explanation = explain_recommendations(client, diverse_ranked, mood_summary, active_summary, watchlist_ids)
    console.print(explanation)
