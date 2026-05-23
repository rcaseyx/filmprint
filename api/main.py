"""FastAPI recommendation service.

Initializes the full pipeline on startup and caches state in memory.
Recommendation requests are fast — the expensive work (CSV sync, TMDB
enrichment, profile build, ranking) happens once at boot.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
import json

import anthropic
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(override=True)

from filmprint.db import (
    init_db, get_or_prompt_user, get_user_ratings, get_user_watchlist,
    get_seen_movie_ids, get_taste_profile, save_taste_profile,
    is_profile_stale, upsert_movie, update_feature_vector,
    log_recommendation, get_recent_recommendation_ids,
)
from filmprint.features import (
    build_feature_vector, taste_summary, build_keyword_vocab,
    build_affinity_scores, GENRES,
)
from filmprint.profile import build_taste_profile, build_taste_clusters, PROFILE_VERSION
from filmprint.recommender import rank_watchlist, diversify
from filmprint.discovery import expand_candidates, discover_by_mood
from filmprint.app import ensure_feature_vectors
from filmprint.tmdb import get_watch_providers
from filmprint.sync import sync_ratings_csv, sync_watchlist_csv, sync_watched_csv, sync_rss, sync_scrape

DATA_DIR = Path(__file__).parent.parent / "data"

# Pipeline state, populated on startup
_state: dict[str, Any] = {}


def _rebuild_state(user_id: int, username: str) -> None:
    """Rebuild profile and ranking from whatever is currently in the DB. No sync."""
    rated_rows = get_user_ratings(user_id)
    rated_movies = ensure_feature_vectors(list(rated_rows))
    ratings = [r["letterboxd_rating"] for r in rated_rows]

    keyword_vocab = build_keyword_vocab(rated_movies)
    affinity = build_affinity_scores(rated_movies, ratings)

    if is_profile_stale(user_id, PROFILE_VERSION):
        profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity)
        clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity)
        save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                           [c.tolist() for c in clusters])
    else:
        profile_data = get_taste_profile(user_id)
        profile_vec = np.array(profile_data["vector"])
        clusters = [np.array(c) for c in profile_data.get("clusters") or []]
        expected_len = 32 + len(keyword_vocab) + 2
        if len(profile_vec) != expected_len:
            profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity)
            clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity)
            save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                               [c.tolist() for c in clusters])

    seen_ids = get_seen_movie_ids(user_id)
    watchlist = ensure_feature_vectors(get_user_watchlist(user_id))
    watchlist_ids = {m["id"] for m in watchlist}

    raw_rated = [m.get("raw_tmdb") or m for m in rated_movies]
    discovered_raw = expand_candidates(raw_rated, ratings, seen_ids)
    for d in discovered_raw:
        upsert_movie(d)
    discovered = ensure_feature_vectors([{**d, "raw_tmdb": d} for d in discovered_raw])

    all_candidates = watchlist + [d for d in discovered if d["id"] not in watchlist_ids]

    recent_ids = get_recent_recommendation_ids(user_id)
    if recent_ids:
        all_candidates = [c for c in all_candidates if c["id"] not in recent_ids]

    ranked = rank_watchlist(profile_vec, all_candidates, keyword_vocab, affinity)

    _state.update({
        "user_id": user_id,
        "username": username,
        "rated_movies": rated_movies,
        "ratings": ratings,
        "profile_vec": profile_vec,
        "clusters": clusters,
        "keyword_vocab": keyword_vocab,
        "affinity": affinity,
        "ranked": ranked,
        "watchlist_ids": watchlist_ids,
        "seen_ids": seen_ids,
        "summary": taste_summary(profile_vec, keyword_vocab),
    })


def _build_pipeline(user_id: int, username: str) -> None:
    """Initial startup: scrape Letterboxd on first run (no prior data), then rebuild state.
    Falls back to CSV exports if present (useful for local dev seed)."""
    from filmprint.db import get_ratings_count

    ratings_path = DATA_DIR / "ratings.csv"
    watchlist_path = DATA_DIR / "watchlist.csv"
    watched_path = DATA_DIR / "watched.csv"

    if ratings_path.exists():
        sync_ratings_csv(user_id, str(ratings_path))
        if watchlist_path.exists():
            sync_watchlist_csv(user_id, str(watchlist_path))
        if watched_path.exists():
            sync_watched_csv(user_id, str(watched_path))
    elif get_ratings_count(user_id) == 0:
        print(f"  No local data — scraping {username}'s Letterboxd profile...")
        sync_scrape(user_id, username)

    _rebuild_state(user_id, username)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    user_id, username = get_or_prompt_user()
    print("Initializing recommendation pipeline...")
    _build_pipeline(user_id, username)
    print(f"Ready — {len(_state['ranked'])} candidates ranked.")
    yield


app = FastAPI(title="filmprint API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- schemas ---

class MoodContext(BaseModel):
    required_genres: list[str] = []
    exclude_genres: list[str] = []
    max_runtime: int | None = None
    tone: str | None = None        # "light" | "dark"
    pacing: str | None = None      # "slow" | "fast"
    familiarity: str | None = None # "familiar" | "challenging"
    free_text: str | None = None


# --- helpers ---

_LIGHTWEIGHT_GENRES = {"Animation", "Family", "Documentary", "Music", "Western", "Romance"}
_SERIOUS_GENRES = {"Thriller", "Crime", "Drama", "Horror", "Mystery", "War", "History", "Science Fiction", "Action", "Adventure"}


def _genre_names(movie: dict) -> list[str]:
    genres = movie.get("genres") or []
    if isinstance(genres, str):
        genres = json.loads(genres)
    return [g["name"] if isinstance(g, dict) else g for g in genres]


def _apply_filters(
    ranked: list[tuple[dict, float]],
    mood: MoodContext,
) -> list[tuple[dict, float]]:
    required = set(mood.required_genres)
    excluded = set(mood.exclude_genres)
    if any(g in _SERIOUS_GENRES for g in required):
        excluded |= _LIGHTWEIGHT_GENRES - required - excluded

    def passes(movie: dict) -> bool:
        genres = set(_genre_names(movie))
        if required and not required & genres:
            return False
        if excluded and excluded & genres:
            return False
        if mood.max_runtime:
            rt = movie.get("runtime")
            if rt and rt > mood.max_runtime:
                return False
        return True

    filtered = [(m, s) for m, s in ranked if passes(m)]
    return filtered or ranked


def _select_cluster(mood: MoodContext) -> "np.ndarray | None":
    clusters = _state.get("clusters") or []
    required = mood.required_genres
    if not clusters or not required:
        return None
    genre_indices = [GENRES.index(g) for g in required if g in GENRES]
    if not genre_indices:
        return None
    return max(clusters, key=lambda c: sum(c[i] for i in genre_indices))


def _mood_to_summary(mood: MoodContext) -> str:
    parts = []
    if mood.required_genres:
        parts.append(f"Genres: {', '.join(mood.required_genres)}")
    if mood.tone:
        parts.append(f"Tone: {mood.tone}")
    if mood.pacing:
        parts.append(f"Pacing: {mood.pacing}-burn")
    if mood.familiarity:
        parts.append(f"Familiarity: {mood.familiarity}")
    if mood.free_text:
        parts.append(mood.free_text)
    return ". ".join(parts) if parts else "No specific mood preference."


def _explain_recommendations(
    top_movies: list[tuple[dict, float]],
    mood_summary: str,
    active_summary: str,
) -> list[dict]:
    client = anthropic.Anthropic()
    watchlist_ids = _state["watchlist_ids"]
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
{active_summary}

What they want tonight:
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
- Reference what they want tonight
- Do NOT reference taste profile labels or invent preferences they didn't mention"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    reply = response.content[0].text

    try:
        raw = json.loads(reply)
    except json.JSONDecodeError:
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
            "poster_path": (movie.get("raw_tmdb") or {}).get("poster_path"),
            "genres": _genre_names(movie),
            "runtime": movie.get("runtime"),
            "streaming": get_watch_providers(movie["id"]),
        })
    return picks


# --- endpoints ---

@app.get("/api/user")
def get_user():
    return {
        "summary": _state.get("summary"),
        "ratings_count": len(_state.get("ratings") or []),
        "watchlist_count": len(_state.get("watchlist_ids") or []),
        "candidates_count": len(_state.get("ranked") or []),
    }


@app.get("/api/profile")
def get_profile():
    """All data needed for the profile page in one call."""
    profile_vec = _state.get("profile_vec")
    rated_movies = _state.get("rated_movies") or []

    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1

    genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))} if profile_vec is not None else {}
    genres = [
        {"name": g, "count": genre_counts[g], "weight": genre_weights.get(g, 0.0)}
        for g in GENRES if genre_counts[g] > 0
    ]
    genres.sort(key=lambda x: x["weight"], reverse=True)

    return {
        "ratings_count": len(_state.get("ratings") or []),
        "watchlist_count": len(_state.get("watchlist_ids") or []),
        "candidates_count": len(_state.get("ranked") or []),
        "summary": _state.get("summary"),
        "genres": genres,
    }


@app.get("/api/genres")
def get_genres():
    """Return genres present in the user's rated films, with profile weights."""
    profile_vec = _state.get("profile_vec")
    rated_movies = _state.get("rated_movies") or []

    # Count how many rated films have each genre
    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1

    # Genre weights from the first 18 dims of the profile vector
    genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))} if profile_vec is not None else {}

    genres = [
        {"name": g, "count": genre_counts[g], "weight": genre_weights.get(g, 0.0)}
        for g in GENRES
        if genre_counts[g] > 0
    ]
    genres.sort(key=lambda x: x["weight"], reverse=True)
    return {"genres": genres}


@app.post("/api/recommendations")
def get_recommendations(mood: MoodContext):
    if not _state:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    ranked = _state["ranked"]
    keyword_vocab = _state["keyword_vocab"]
    affinity = _state["affinity"]
    profile_vec = _state["profile_vec"]

    cluster = _select_cluster(mood)
    active_vec = cluster if cluster is not None else profile_vec
    if cluster is not None:
        all_candidates = [m for m, _ in ranked]
        ranked = rank_watchlist(cluster, all_candidates, keyword_vocab, affinity)
        active_summary = taste_summary(cluster, keyword_vocab)
    else:
        active_summary = _state["summary"]

    # Augment with TMDB Discover when mood specifies genres
    if mood.required_genres:
        existing_ids = {m["id"] for m, _ in ranked}
        excluded = _state.get("seen_ids", set()) | existing_ids
        discovered_raw = discover_by_mood(mood.required_genres, existing_ids=excluded)
        if discovered_raw:
            for d in discovered_raw:
                upsert_movie(d)
            discovered = ensure_feature_vectors([{**d, "raw_tmdb": d} for d in discovered_raw])
            new_ranked = rank_watchlist(active_vec, discovered, keyword_vocab, affinity)
            ranked = sorted(ranked + new_ranked, key=lambda x: x[1], reverse=True)

    filtered = _apply_filters(ranked, mood)
    diverse = diversify(filtered, ranked, keyword_vocab, affinity)

    mood_summary = _mood_to_summary(mood)
    picks = _explain_recommendations(diverse, mood_summary, active_summary)

    user_id = _state["user_id"]
    mood_context = {"summary": mood_summary, "filters": mood.model_dump()}
    for pick in picks:
        log_recommendation(user_id, pick["id"], pick["score"], mood_context)

    return {"picks": picks, "mood_summary": mood_summary}


@app.post("/api/sync")
def sync():
    """Scrape latest ratings and watchlist from Letterboxd, rebuild profile and ranking."""
    if not _state:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    user_id = _state["user_id"]
    username = _state["username"]

    ratings_before = len(_state.get("ratings") or [])
    watchlist_before = len(_state.get("watchlist_ids") or [])

    sync_scrape(user_id, username)
    _rebuild_state(user_id, username)

    return {
        "ratings_added": len(_state.get("ratings") or []) - ratings_before,
        "watchlist_added": len(_state.get("watchlist_ids") or []) - watchlist_before,
        "ratings_count": len(_state.get("ratings") or []),
        "watchlist_count": len(_state.get("watchlist_ids") or []),
        "candidates_count": len(_state.get("ranked") or []),
    }
