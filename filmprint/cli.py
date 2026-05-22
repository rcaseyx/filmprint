"""CLI entry point — conversational mood Q&A, then tonight's picks."""

import json
import time
import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)
from rich.console import Console
from filmprint.features import GENRES

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


def gather_mood_context(client: anthropic.Anthropic, taste_summary: str) -> tuple[str, dict]:
    MAX_QUESTIONS = 5

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
- Vary your opening angle each run: sometimes start with energy level or mood, sometimes with a specific genre or director style they like, sometimes with social context (solo vs. with someone) or pacing. Don't follow the same pattern every time.
- The summary should capture: mood/tone, anything to avoid
- For required_genres and exclude_genres, use exact names from this list only: {", ".join(GENRES)}
- Map adjacent concepts aggressively: espionage → Thriller, space/sci-fi → Science Fiction, heist → Crime
- max_runtime: integer minutes if they want something short, null otherwise
- Output ONLY valid JSON, no commentary"""

    messages = [{"role": "user", "content": "What should I watch tonight?"}]
    qa_history = []
    console.print()

    for _ in range(MAX_QUESTIONS):
        reply = _call_claude(
            client,
            model="claude-sonnet-4-6",
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
            filters = {
                "required_genres": parsed.get("required_genres") or [],
                "exclude_genres": parsed.get("exclude_genres") or [],
                "max_runtime": parsed.get("max_runtime"),
            }
            return parsed["summary"], filters

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
        qa_history.append((question, chosen))
        messages.append({"role": "user", "content": chosen})

    # Hit the cap — request final summary
    messages.append({"role": "user", "content": "That's all the questions. Please provide your summary now."})
    reply = _call_claude(
        client,
        model="claude-sonnet-4-6",
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


def run(rated_movies, ratings, ranked, taste_summary, watchlist_ids):
    client = anthropic.Anthropic()

    console.print("\n[bold]Let's figure out what to watch tonight.[/bold]")
    mood_summary, filters = gather_mood_context(client, taste_summary)
    filtered_ranked = apply_mood_filters(ranked, filters)

    console.print("\n[bold]Finding your best picks...[/bold]\n")
    explanation = explain_recommendations(client, filtered_ranked, mood_summary, taste_summary, watchlist_ids)
    console.print(explanation)
