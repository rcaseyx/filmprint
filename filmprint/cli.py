"""CLI entry point — ask mood questions, then surface tonight's top picks."""

import os
import anthropic
from rich.console import Console
from rich.table import Table

console = Console()


def ask_mood_questions(client: anthropic.Anthropic) -> str:
    """Use Claude to ask the user a few questions and return a mood summary."""
    console.print("\n[bold]Let me ask you a few questions to narrow things down.[/bold]\n")

    questions = [
        "How much time do you have? (e.g. under 90 min, around 2 hours, happy to go long)",
        "What kind of mood are you in? (e.g. something light, heavy/emotional, thrilling, thought-provoking)",
        "Anything you're NOT in the mood for tonight?",
    ]

    answers = []
    for q in questions:
        console.print(f"[cyan]{q}[/cyan]")
        answer = input("> ").strip()
        answers.append(answer)

    mood_summary = f"""
Runtime preference: {answers[0]}
Mood: {answers[1]}
Avoiding: {answers[2]}
""".strip()

    return mood_summary


def explain_recommendations(
    client: anthropic.Anthropic,
    top_movies: list[tuple[dict, float]],
    mood_summary: str,
    taste_summary: str,
) -> str:
    """Ask Claude to explain the top picks in context of mood and taste."""
    movie_list = "\n".join(
        f"- {m['title']} ({m.get('release_date', '')[:4]}) — score: {score:.2f}"
        for m, score in top_movies[:10]
    )

    prompt = f"""You are a film recommendation assistant. Based on the user's taste profile and tonight's mood, explain why the top-ranked films are good picks and surface the 3-5 best ones.

Taste profile summary:
{taste_summary}

Tonight's mood:
{mood_summary}

Top-scored films from their watchlist:
{movie_list}

Pick the 3-5 best matches for tonight and explain why each one fits. Be concise and specific."""

    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def run(rated_movies, ratings, watchlist_movies, ranked, taste_summary):
    client = anthropic.Anthropic()
    mood_summary = ask_mood_questions(client)

    console.print("\n[bold]Finding your best matches...[/bold]\n")
    explanation = explain_recommendations(client, ranked, mood_summary, taste_summary)
    console.print(explanation)
