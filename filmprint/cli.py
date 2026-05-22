"""CLI entry point — conversational mood Q&A, then tonight's picks."""

import json
import time
import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)
from rich.console import Console

console = Console()

CONTEXT_DONE = "CONTEXT_COMPLETE"


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


def gather_mood_context(client: anthropic.Anthropic, taste_summary: str) -> str:
    """
    Multi-turn conversation where Claude asks personalized questions
    based on the user's taste profile, then returns a mood summary.
    """
    system = f"""You are a knowledgeable film friend helping someone pick what to watch tonight.

Their taste profile (strongest signals from their ratings):
{taste_summary}

Your job: ask 2-3 short, conversational questions to understand their mood tonight.
Rules:
- Ask ONE question at a time
- Make questions specific to their actual taste — reference genres or styles they like
- Keep it casual, like texting a friend
- After you have enough context (2-3 exchanges), write "{CONTEXT_DONE}" on its own line, then on the next line write "SUMMARY:" followed by a concise mood summary to pass to the recommendation engine
- The summary should capture: runtime preference, mood/tone, anything they want to avoid"""

    messages = [{"role": "user", "content": "What should I watch tonight?"}]
    console.print()

    while True:
        reply = _call_claude(
            client,
            model="claude-sonnet-4-6",
            max_tokens=200,
            system=system,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": reply})

        if CONTEXT_DONE in reply:
            if "SUMMARY:" in reply:
                return reply.split("SUMMARY:")[-1].strip()
            return reply.split(CONTEXT_DONE)[0].strip()

        console.print(f"[cyan]{reply}[/cyan]\n")
        user_input = input("> ").strip()
        messages.append({"role": "user", "content": user_input})


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

The user's taste profile (strongest signals from their ratings):
{taste_summary}

Tonight's context (from your conversation with them):
{mood_summary}

Top candidates ranked by taste-profile match. [watchlist] = films they already wanted to see, [discovered] = surfaced based on similarity to films they've loved:
{movie_list}

Pick the 3-5 best films for tonight. Don't just list the highest-scored ones — use real judgment. A discovered film that perfectly fits tonight's mood might beat a watchlist film with a slightly higher score. For each pick, give a specific reason why it's right for tonight, referencing both their taste and their mood. Be concise and direct — like a friend texting a recommendation, not writing a review."""

    return _call_claude(
        client,
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )


def run(rated_movies, ratings, ranked, taste_summary, watchlist_ids):
    client = anthropic.Anthropic()

    console.print("\n[bold]Let's figure out what to watch tonight.[/bold]")
    mood_summary = gather_mood_context(client, taste_summary)

    console.print("\n[bold]Finding your best picks...[/bold]\n")
    explanation = explain_recommendations(client, ranked, mood_summary, taste_summary, watchlist_ids)
    console.print(explanation)
