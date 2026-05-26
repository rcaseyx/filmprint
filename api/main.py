"""FastAPI recommendation service.

Initializes the full pipeline on startup and caches state in memory.
Recommendation requests are fast — the expensive work (CSV sync, TMDB
enrichment, profile build, ranking) happens once at boot.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
import json
import os
import tempfile
import zipfile

import anthropic
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(override=True)

from filmprint.db import (
    init_db, get_or_create_user_by_email, update_user_username,
    create_user_with_password, verify_user_password,
    get_user_by_username, search_users_by_username,
    get_user_ratings, get_user_watchlist,
    get_seen_movie_ids, get_taste_profile, save_taste_profile,
    is_profile_stale, upsert_movie, update_feature_vector,
    log_recommendation, get_recent_ratings, get_recommendation_history,
    resolve_recommendation_outcomes, get_recommendation_boosts,
    get_ratings_count, get_all_users_with_stats, delete_user,
    get_all_keyword_themes_full, get_candidate_movies,
)
from filmprint.features import (
    build_feature_vector, taste_summary, build_keyword_vocab,
    build_affinity_scores, GENRES, DECADES, compute_axis_scores, TONE_AXES, SUBGENRE_AXES,
    _movie_keywords,
)
from filmprint.profile import build_taste_profile, build_taste_clusters, build_critic_profile, personal_neutral, PROFILE_VERSION
from filmprint.recommender import rank_watchlist, diversify
from filmprint.discovery import expand_candidates, discover_by_mood
from filmprint.app import ensure_feature_vectors
from filmprint.tmdb import get_watch_providers
from filmprint.omdb import get_scores
from filmprint.sync import sync_ratings_csv, sync_watchlist_csv, sync_watched_csv, sync_rss, sync_scrape
from filmprint.letterboxd import validate_username
from filmprint.themes import assign_new_keywords, build_user_subgenre_axes, backfill_catalog_keywords, build_clusters, claude_cleanup_themes
import requests as _requests

DATA_DIR = Path(__file__).parent.parent / "data"

# Buffer subtracted from the computed quality_floor when enforcing and displaying it.
# Gives under-reviewed films breathing room without changing the floor's derivation.
FLOOR_TOLERANCE = 0.5

# Per-user pipeline state, keyed by user_id, built lazily on first request
_user_states: dict[int, dict[str, Any]] = {}

# Lightweight profile-only state — no candidate discovery, used by profile/genres endpoints
_user_profile_states: dict[int, dict[str, Any]] = {}


def _rebuild_state(user_id: int, username: str) -> None:
    """Rebuild profile and ranking from whatever is currently in the DB. No sync."""
    resolve_recommendation_outcomes(user_id)
    outcome_boosts = get_recommendation_boosts(user_id)

    rated_rows = get_user_ratings(user_id)
    rated_movies = ensure_feature_vectors(list(rated_rows))
    ratings = [r["letterboxd_rating"] for r in rated_rows]

    keyword_vocab = build_keyword_vocab(rated_movies)
    assign_new_keywords(keyword_vocab)
    user_subgenre_axes = build_user_subgenre_axes(keyword_vocab)
    affinity = build_affinity_scores(rated_movies, ratings)

    stale = is_profile_stale(user_id, PROFILE_VERSION)

    if stale:
        profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes)
        clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes)
        save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                           [c.tolist() for c in clusters])
    else:
        profile_data = get_taste_profile(user_id)
        profile_vec = np.array(profile_data["vector"])
        clusters = [np.array(c) for c in profile_data.get("clusters") or []]
        expected_len = 35 + len(keyword_vocab) + 2 + len(user_subgenre_axes) + len(TONE_AXES)
        if len(profile_vec) != expected_len:
            stale = True
            profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes)
            clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes)
            save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                               [c.tolist() for c in clusters])

    seen_ids = get_seen_movie_ids(user_id)
    watchlist = ensure_feature_vectors(get_user_watchlist(user_id))
    watchlist_ids = {m["id"] for m in watchlist}

    if stale:
        raw_rated = [m.get("raw_tmdb") or m for m in rated_movies]
        # Pre-fetch all known raw_tmdb from DB so expand_candidates can skip TMDB API
        # calls for movies we already have. Matters most on cold starts after a restart.
        all_known_raw = {m["id"]: m["raw_tmdb"] for m in get_candidate_movies(set(), limit=2000)}
        discovered_raw = expand_candidates(raw_rated, ratings, seen_ids, known_raw=all_known_raw)
        for d in discovered_raw:
            upsert_movie(d)
        discovered = ensure_feature_vectors([{**d, "raw_tmdb": d} for d in discovered_raw])
    else:
        discovered = get_candidate_movies(seen_ids | watchlist_ids)

    critic = build_critic_profile(rated_movies, ratings)
    quality_floor = critic["quality_floor"]

    def _above_floor(movie: dict) -> bool:
        va = movie.get("vote_average") or 0
        return va == 0 or va >= quality_floor  # pass through if no votes yet

    all_candidates = (
        [m for m in watchlist if m["id"] not in seen_ids and _above_floor(m)]
        + [d for d in discovered if d["id"] not in watchlist_ids and _above_floor(d)]
    )

    ranked = rank_watchlist(profile_vec, all_candidates, keyword_vocab, affinity, user_subgenre_axes)

    _user_states[user_id] = {
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
        "session_recommended_ids": set(),
        "quality_floor": quality_floor,
        "critic_alignment": critic["alignment"],
        "neutral": critic["neutral"],
        "summary": taste_summary(profile_vec, keyword_vocab, user_subgenre_axes),
        "user_subgenre_axes": user_subgenre_axes,
    }
    # Full state supersedes the lightweight profile-only cache
    _user_profile_states.pop(user_id, None)


def _rebuild_profile_only(user_id: int, username: str) -> None:
    """Build and cache profile state without candidate discovery.

    Significantly faster than _rebuild_state — only hits the DB and runs pure
    computation. Used by profile/genres endpoints that don't need ranked candidates.
    """
    resolve_recommendation_outcomes(user_id)
    outcome_boosts = get_recommendation_boosts(user_id)

    rated_rows = get_user_ratings(user_id)
    rated_movies = ensure_feature_vectors(list(rated_rows))
    ratings = [r["letterboxd_rating"] for r in rated_rows]

    keyword_vocab = build_keyword_vocab(rated_movies)
    assign_new_keywords(keyword_vocab)
    user_subgenre_axes = build_user_subgenre_axes(keyword_vocab)
    affinity = build_affinity_scores(rated_movies, ratings)

    stale = is_profile_stale(user_id, PROFILE_VERSION)
    if stale:
        profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes)
        clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes)
        save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                           [c.tolist() for c in clusters])
    else:
        profile_data = get_taste_profile(user_id)
        profile_vec = np.array(profile_data["vector"])
        clusters = [np.array(c) for c in profile_data.get("clusters") or []]
        expected_len = 35 + len(keyword_vocab) + 2 + len(user_subgenre_axes) + len(TONE_AXES)
        if len(profile_vec) != expected_len:
            profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes)
            clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes)
            save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                               [c.tolist() for c in clusters])

    watchlist_ids = {m["id"] for m in get_user_watchlist(user_id)}
    seen_ids = get_seen_movie_ids(user_id)
    critic = build_critic_profile(rated_movies, ratings)

    _user_profile_states[user_id] = {
        "user_id": user_id,
        "username": username,
        "rated_movies": rated_movies,
        "ratings": ratings,
        "profile_vec": profile_vec,
        "clusters": clusters,
        "keyword_vocab": keyword_vocab,
        "affinity": affinity,
        "watchlist_ids": watchlist_ids,
        "seen_ids": seen_ids,
        "quality_floor": critic["quality_floor"],
        "critic_alignment": critic["alignment"],
        "neutral": critic["neutral"],
        "summary": taste_summary(profile_vec, keyword_vocab, user_subgenre_axes),
        "user_subgenre_axes": user_subgenre_axes,
    }


def _get_or_build_profile(user_id: int, username: str) -> dict:
    """Return profile state — uses full state if already built, otherwise fast profile-only path."""
    if user_id in _user_states:
        return _user_states[user_id]
    if user_id not in _user_profile_states and username and get_ratings_count(user_id) > 0:
        _rebuild_profile_only(user_id, username)
    return _user_profile_states.get(user_id, {})


def _get_or_build_state(user_id: int, username: str) -> dict:
    """Return cached state for user, building it lazily if they have data in the DB."""
    if user_id not in _user_states and username and get_ratings_count(user_id) > 0:
        _rebuild_state(user_id, username)
    return _user_states.get(user_id, {})


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(seed_data=SUBGENRE_AXES)
    backfill_catalog_keywords()
    yield


app = FastAPI(title="filmprint API", lifespan=lifespan)

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- auth dependencies ---

async def get_current_user(request: Request) -> dict:
    email = request.headers.get("X-User-Email")
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user_id, username = get_or_create_user_by_email(email)
    return {"user_id": user_id, "username": username or "", "email": email}


_ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")


async def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    if not _ADMIN_EMAIL or current_user["email"] != _ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    return current_user


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

_MOOD_TONE_KEYWORDS: dict[str, list[str]] = {
    "dark": TONE_AXES["Dark"],
    "light": TONE_AXES["Warm"],
}
_MOOD_PACING_KEYWORDS: dict[str, list[str]] = {
    "fast": TONE_AXES["Intense"],
    "slow": TONE_AXES["Cerebral"],
}
_MOOD_FAMILIARITY_KEYWORDS: dict[str, list[str]] = {
    "challenging": TONE_AXES["Cerebral"] + TONE_AXES["Fantastical"],
    # "familiar" needs no direction — the base profile already captures what the user knows they like
}
_MOOD_BOOST_WEIGHT = 0.3


def _apply_mood_to_vector(
    vec: "np.ndarray",
    mood: "MoodContext",
    keyword_vocab: list[str],
    subgenre_axes: dict,
) -> "np.ndarray":
    """Blend a mood direction into a profile vector before ranking.

    Constructs a synthetic 'ideal mood film' using the relevant tone-axis
    keywords, builds its feature vector, then blends it in so ranking
    actually reflects tone/pacing/familiarity — not just the Claude prompt.
    """
    synthetic_kws: set[str] = set()
    if mood.tone:
        synthetic_kws.update(_MOOD_TONE_KEYWORDS.get(mood.tone, []))
    if mood.pacing:
        synthetic_kws.update(_MOOD_PACING_KEYWORDS.get(mood.pacing, []))
    if mood.familiarity:
        synthetic_kws.update(_MOOD_FAMILIARITY_KEYWORDS.get(mood.familiarity, []))
    if not synthetic_kws:
        return vec

    synthetic_movie = {"raw_tmdb": {"keywords": [{"name": kw} for kw in synthetic_kws]}}
    mood_dir = build_feature_vector(synthetic_movie, keyword_vocab, subgenre_axes=subgenre_axes)
    blended = vec + _MOOD_BOOST_WEIGHT * mood_dir
    norm = np.linalg.norm(blended)
    return blended / norm if norm > 0 else blended


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


def _select_cluster(mood: MoodContext, state: dict) -> "np.ndarray | None":
    clusters = state.get("clusters") or []
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
    watchlist_ids: set,
) -> list[dict]:
    client = anthropic.Anthropic()
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

    selected = []
    for item in raw:
        idx = item["idx"]
        if idx >= len(candidates):
            continue
        movie, score = candidates[idx]
        selected.append((movie, score, item["reason"]))

    def _enrich(args):
        movie, score, reason = args
        return {
            "id": movie["id"],
            "title": movie["title"],
            "year": movie.get("year") or (movie.get("release_date", "") or "")[:4],
            "source": "watchlist" if movie["id"] in watchlist_ids else "discovered",
            "score": score,
            "reason": reason,
            "poster_path": (movie.get("raw_tmdb") or {}).get("poster_path"),
            "genres": _genre_names(movie),
            "runtime": movie.get("runtime"),
            "streaming": get_watch_providers(movie["id"]),
            "scores": get_scores((movie.get("raw_tmdb") or movie).get("imdb_id", "")),
        }

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_enrich, args): i for i, args in enumerate(selected)}
        ordered = [None] * len(selected)
        for future in as_completed(futures):
            ordered[futures[future]] = future.result()

    return [p for p in ordered if p is not None]


# --- auth endpoints (no X-User-Email required) ---

class CredentialsPayload(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
def register(payload: CredentialsPayload):
    try:
        user_id = create_user_with_password(payload.email, payload.password)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"user_id": user_id}


@app.post("/api/auth/verify")
def verify_credentials(payload: CredentialsPayload):
    result = verify_user_password(payload.email, payload.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user_id, username = result
    return {"user_id": user_id, "email": payload.email, "username": username}


# --- endpoints ---

@app.get("/api/user")
def get_user(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    username = current_user["username"]
    # Use a direct DB count so this endpoint is always fast — no state build triggered.
    # Endpoints that need full state (_get_or_build_state) do so lazily on first request.
    ratings_count = get_ratings_count(user_id)
    state = _user_states.get(user_id, {})
    return {
        "has_profile": ratings_count > 0,
        "needs_username": not username,
        "username": username or None,
        "summary": state.get("summary"),
        "ratings_count": ratings_count,
        "watchlist_count": len(state.get("watchlist_ids") or []),
        "candidates_count": len(state.get("ranked") or []),
    }


@app.get("/api/profile")
def get_profile(current_user: dict = Depends(get_current_user)):
    """All data needed for the profile page in one call."""
    user_id = current_user["user_id"]
    username = current_user["username"]
    state = _get_or_build_profile(user_id, username)

    profile_vec = state.get("profile_vec")
    rated_movies = state.get("rated_movies") or []

    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1

    if profile_vec is not None:
        genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))}
        decade_weights = {DECADES[i]: float(profile_vec[len(GENRES) + i]) for i in range(len(DECADES))}
    else:
        genre_weights = {}
        decade_weights = {}

    genres = [
        {"name": g, "count": genre_counts[g], "weight": genre_weights.get(g, 0.0)}
        for g in GENRES if genre_counts[g] > 0
    ]
    genres.sort(key=lambda x: x["weight"], reverse=True)

    decades = [
        {"name": d, "weight": decade_weights.get(d, 0.0)}
        for d in DECADES
        if decade_weights.get(d, 0.0) > 0
    ]

    neutral = state.get("neutral", 3.0)
    director_scores: dict[str, float] = dict((state.get("affinity") or {}).get("directors", {}))

    # Count how many rated films each director has
    director_counts: dict[str, int] = {}
    for movie in rated_movies:
        raw = movie.get("raw_tmdb") or movie
        crew = (raw.get("credits") or {}).get("crew", [])
        for p in crew:
            if p.get("job") == "Director":
                n = p["name"]
                director_counts[n] = director_counts.get(n, 0) + 1

    # Merge Coen brothers into a single entry
    COENS = {"Joel Coen", "Ethan Coen", "Joel Coen Jr."}
    coen_scores = [director_scores[n] for n in COENS if n in director_scores]
    if len(coen_scores) > 1:
        director_scores["Coen Brothers"] = sum(coen_scores) / len(coen_scores)
        director_counts["Coen Brothers"] = max(director_counts.get(n, 0) for n in COENS)
        for n in COENS:
            director_scores.pop(n, None)
            director_counts.pop(n, None)

    directors = sorted(
        [
            {
                "name": name,
                "shortName": "Coens" if name == "Coen Brothers" else name.split()[-1],
                "weight": round(score - neutral, 3),
            }
            for name, score in director_scores.items()
            if score > neutral and director_counts.get(name, 0) >= 2
        ],
        key=lambda x: x["weight"],
        reverse=True,
    )[:8]

    ratings = state.get("ratings") or []
    avg_rating = round(sum(ratings) / len(ratings), 1) if ratings else 0.0

    tone = compute_axis_scores(rated_movies, ratings, TONE_AXES)
    all_subgenres = compute_axis_scores(
        rated_movies, ratings,
        state.get("user_subgenre_axes") or SUBGENRE_AXES,
    )
    subgenres = [s for s in all_subgenres if s["weight"] > 0][:8]

    return {
        "ratings_count": len(ratings),
        "watchlist_count": len(state.get("watchlist_ids") or []),
        "avg_rating": avg_rating,
        "summary": state.get("summary"),
        "genres": genres,
        "decades": decades,
        "directors": directors,
        "tone": tone,
        "subgenres": subgenres,
        "critic_alignment": state.get("critic_alignment", 0.0),
        "quality_floor": round(state.get("quality_floor", 6.0) - FLOOR_TOLERANCE, 2),
        "neutral": neutral,
    }


@app.get("/api/profile/examples")
def profile_examples(current_user: dict = Depends(get_current_user)):
    """Return top 3 film examples per radar axis, deduplicated within each radar.

    Deduplication ensures each film appears on at most one axis — so hovering
    different points shows different posters rather than the same top-rated films.
    """
    user_id = current_user["user_id"]
    username = current_user["username"]
    state = _get_or_build_profile(user_id, username)
    rated_movies = state.get("rated_movies") or []
    ratings = state.get("ratings") or []

    def _serialize(m: dict, r: float) -> dict:
        return {
            "id": m["id"],
            "title": m["title"],
            "year": m.get("year"),
            "rating": r,
            "poster_path": (m.get("raw_tmdb") or {}).get("poster_path"),
        }

    def pick_examples(axes: list[str], match_fn) -> dict[str, list[dict]]:
        used_ids: set[int] = set()
        result: dict[str, list[dict]] = {}
        for name in axes:
            candidates = sorted(
                [(m, r) for m, r in zip(rated_movies, ratings)
                 if match_fn(name, m) and m["id"] not in used_ids],
                key=lambda x: x[1], reverse=True,
            )
            for m, r in candidates[:3]:
                used_ids.add(m["id"])
            result[name] = [_serialize(m, r) for m, r in candidates[:3]]
        return result

    # ── genres: top 8 by profile weight, same order as radar ─────────────────
    profile_vec = state.get("profile_vec")
    genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))} if profile_vec is not None else {}
    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1
    top_genres = sorted(
        [g for g in GENRES if genre_counts.get(g, 0) > 0],
        key=lambda g: genre_weights.get(g, 0.0), reverse=True,
    )[:8]

    genre_ex = pick_examples(top_genres, lambda name, m: name in set(_genre_names(m)))

    # ── subgenres: top active axes, same list as radar ────────────────────────
    user_subgenre_axes = state.get("user_subgenre_axes") or SUBGENRE_AXES
    all_subgenres = compute_axis_scores(rated_movies, ratings, user_subgenre_axes)
    top_subgenres = [s["name"] for s in all_subgenres if s["weight"] > 0][:8]

    def subgenre_match(name: str, m: dict) -> bool:
        kws = set(SUBGENRE_AXES.get(name) or TONE_AXES.get(name) or user_subgenre_axes.get(name) or [])
        return bool(_movie_keywords(m) & kws)

    subgenre_ex = pick_examples(top_subgenres, subgenre_match)

    # ── era: active decades (positive weight) ─────────────────────────────────
    decade_weights = {DECADES[i]: float(profile_vec[len(GENRES) + i]) for i in range(len(DECADES))} if profile_vec is not None else {}
    active_decades = [d for d in DECADES if decade_weights.get(d, 0.0) > 0]

    def era_match(decade_name: str, m: dict) -> bool:
        raw = m.get("raw_tmdb") or m
        release = (raw.get("release_date", "") or "")
        year = raw.get("year") or (int(release[:4]) if len(release) >= 4 else None)
        if not year:
            return False
        return f"{(year // 10) * 10}s" == decade_name

    era_ex = pick_examples(active_decades, era_match)

    # ── tone: all 5 axes ───────────────────────────────────────────────────────
    def tone_match(axis_name: str, m: dict) -> bool:
        kws = set(TONE_AXES.get(axis_name, []))
        return bool(_movie_keywords(m) & kws)

    tone_ex = pick_examples(list(TONE_AXES.keys()), tone_match)

    return {"genre": genre_ex, "subgenre": subgenre_ex, "era": era_ex, "tone": tone_ex}


@app.get("/api/genres")
def get_genres(current_user: dict = Depends(get_current_user)):
    """Return genres present in the user's rated films, with profile weights."""
    user_id = current_user["user_id"]
    username = current_user["username"]
    state = _get_or_build_profile(user_id, username)
    profile_vec = state.get("profile_vec")
    rated_movies = state.get("rated_movies") or []

    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1

    genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))} if profile_vec is not None else {}

    genres = [
        {"name": g, "count": genre_counts[g], "weight": genre_weights.get(g, 0.0)}
        for g in GENRES
        if genre_counts[g] > 0
    ]
    genres.sort(key=lambda x: x["weight"], reverse=True)
    return {"genres": genres}


@app.get("/api/ratings/recent")
def recent_ratings(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    rows = get_recent_ratings(user_id, limit=20)
    result = []
    for m in rows:
        raw = m.get("raw_tmdb") or {}
        result.append({
            "id": m["id"],
            "title": m["title"],
            "year": m.get("year"),
            "rating": m["letterboxd_rating"],
            "rated_at": m.get("rated_at"),
            "poster_path": raw.get("poster_path"),
            "genres": json.loads(m["genres"]) if isinstance(m.get("genres"), str) else (m.get("genres") or []),
            "runtime": m.get("runtime"),
        })
    return {"ratings": result}


@app.get("/api/recommendations/history")
def recommendation_history(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    rows = get_recommendation_history(user_id, limit=20)
    result = []
    for m in rows:
        raw = m.get("raw_tmdb") or {}
        mood = m.get("mood_context") or {}
        mood_filters = mood.get("filters") or {}
        result.append({
            "id": m["id"],
            "movie_id": m["movie_id"],
            "title": m["title"],
            "year": m.get("year"),
            "recommended_at": m.get("recommended_at"),
            "poster_path": raw.get("poster_path"),
            "genres": json.loads(m["genres"]) if isinstance(m.get("genres"), str) else (m.get("genres") or []),
            "runtime": m.get("runtime"),
            "score": m.get("score"),
            "followed_through": bool(m.get("followed_through")),
            "follow_up_rating": m.get("follow_up_rating"),
            "mood_genres": mood_filters.get("required_genres") or [],
            "mood_tone": mood_filters.get("tone"),
        })
    return {"history": result}


@app.post("/api/recommendations")
def get_recommendations(mood: MoodContext, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    username = current_user["username"]
    state = _get_or_build_state(user_id, username)

    if not state:
        raise HTTPException(status_code=428, detail="Import your Letterboxd data first")

    session_ids = state.get("session_recommended_ids", set())
    ranked = [(m, s) for m, s in state["ranked"] if m["id"] not in session_ids]
    keyword_vocab = state["keyword_vocab"]
    affinity = state["affinity"]
    profile_vec = state["profile_vec"]
    watchlist_ids = state["watchlist_ids"]

    user_subgenre_axes = state.get("user_subgenre_axes") or {}
    cluster = _select_cluster(mood, state)
    active_vec = cluster if cluster is not None else profile_vec
    if cluster is not None:
        all_candidates = [m for m, _ in ranked]
        ranked = rank_watchlist(cluster, all_candidates, keyword_vocab, affinity, user_subgenre_axes)
        active_summary = taste_summary(cluster, keyword_vocab, user_subgenre_axes)
    else:
        active_summary = state["summary"]

    active_vec = _apply_mood_to_vector(active_vec, mood, keyword_vocab, user_subgenre_axes)
    if mood.tone or mood.pacing or mood.familiarity:
        all_candidates = [m for m, _ in ranked]
        ranked = rank_watchlist(active_vec, all_candidates, keyword_vocab, affinity, user_subgenre_axes)

    # Augment with TMDB Discover when mood specifies genres
    if mood.required_genres:
        existing_ids = {m["id"] for m, _ in ranked}
        excluded = state.get("seen_ids", set()) | existing_ids | session_ids
        quality_floor = state.get("quality_floor", 6.0)
        discovered_raw = discover_by_mood(mood.required_genres, existing_ids=excluded)
        if discovered_raw:
            discovered_raw = [
                d for d in discovered_raw
                if not d.get("vote_average") or d["vote_average"] >= quality_floor
            ]
            for d in discovered_raw:
                upsert_movie(d)
            discovered = ensure_feature_vectors([{**d, "raw_tmdb": d} for d in discovered_raw])
            new_ranked = rank_watchlist(active_vec, discovered, keyword_vocab, affinity, user_subgenre_axes)
            ranked = sorted(ranked + new_ranked, key=lambda x: x[1], reverse=True)

    filtered = _apply_filters(ranked, mood)
    diverse = diversify(filtered, ranked, keyword_vocab, affinity, user_subgenre_axes)

    # Hard-enforce the quality floor using IMDb scores — only for movies whose
    # scores are already disk-cached. Fetching OMDB live per-candidate is too slow;
    # the TMDB vote_average pre-screen (_above_floor) handles cold paths.
    quality_floor = state.get("quality_floor", 6.0)
    from filmprint.omdb import CACHE_DIR as _OMDB_CACHE_DIR
    imdb_filtered = []
    for m, s in diverse:
        raw = m.get("raw_tmdb") or m
        imdb_id = raw.get("imdb_id", "")
        if imdb_id and (_OMDB_CACHE_DIR / f"omdb_{imdb_id}.json").exists():
            imdb_str = get_scores(imdb_id).get("imdb")
            if imdb_str is not None and float(imdb_str) < quality_floor - FLOOR_TOLERANCE:
                continue
        imdb_filtered.append((m, s))
    diverse = imdb_filtered or diverse

    mood_summary = _mood_to_summary(mood)
    picks = _explain_recommendations(diverse, mood_summary, active_summary, watchlist_ids)

    mood_context = {"summary": mood_summary, "filters": mood.model_dump()}
    for pick in picks:
        log_recommendation(user_id, pick["id"], pick["score"], mood_context)
        state["session_recommended_ids"].add(pick["id"])

    return {"picks": picks, "mood_summary": mood_summary}


@app.post("/api/sync")
def sync(current_user: dict = Depends(get_current_user)):
    """Scrape latest ratings and watchlist from Letterboxd, rebuild profile and ranking."""
    user_id = current_user["user_id"]
    username = current_user["username"]

    if not username:
        raise HTTPException(status_code=428, detail="Set your Letterboxd username before syncing")

    state = _user_states.get(user_id, {})
    ratings_before = len(state.get("ratings") or [])
    watchlist_before = len(state.get("watchlist_ids") or [])

    sync_scrape(user_id, username)
    sync_rss(user_id, username)
    _rebuild_state(user_id, username)

    new_state = _user_states.get(user_id, {})
    return {
        "ratings_added": len(new_state.get("ratings") or []) - ratings_before,
        "watchlist_added": len(new_state.get("watchlist_ids") or []) - watchlist_before,
        "ratings_count": len(new_state.get("ratings") or []),
        "watchlist_count": len(new_state.get("watchlist_ids") or []),
        "candidates_count": len(new_state.get("ranked") or []),
    }


@app.post("/api/import")
async def import_csv(
    current_user: dict = Depends(get_current_user),
    file: UploadFile = File(...),
    username: str | None = Form(None),
):
    """Accept a Letterboxd data export (.zip or individual CSV) and ingest it."""
    user_id = current_user["user_id"]
    active_username = current_user["username"]

    # Validate and save username if this is first-time setup
    if username and not active_username:
        try:
            exists = validate_username(username)
        except _requests.RequestException:
            raise HTTPException(status_code=503, detail="Could not reach Letterboxd to verify your username — please try again")
        if not exists:
            raise HTTPException(status_code=422, detail=f"Letterboxd username '{username}' not found")
        update_user_username(user_id, username)
        active_username = username

    state = _user_states.get(user_id, {})
    ratings_before = len(state.get("ratings") or [])
    watchlist_before = len(state.get("watchlist_ids") or [])

    content = await file.read()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        if file.filename and file.filename.endswith(".zip"):
            zip_path = tmp_path / "export.zip"
            zip_path.write_bytes(content)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(tmp_path)
        else:
            (tmp_path / (file.filename or "ratings.csv")).write_bytes(content)

        ratings_csv = next(tmp_path.rglob("ratings.csv"), None)
        watchlist_csv = next(tmp_path.rglob("watchlist.csv"), None)
        watched_csv = next(tmp_path.rglob("watched.csv"), None)

        if not any([ratings_csv, watchlist_csv, watched_csv]):
            raise HTTPException(status_code=422, detail="No ratings.csv, watchlist.csv, or watched.csv found in upload")

        if ratings_csv:
            sync_ratings_csv(user_id, str(ratings_csv))
        if watchlist_csv:
            sync_watchlist_csv(user_id, str(watchlist_csv))
        if watched_csv:
            sync_watched_csv(user_id, str(watched_csv))

    _rebuild_state(user_id, active_username)

    new_state = _user_states.get(user_id, {})
    return {
        "ratings_added": len(new_state.get("ratings") or []) - ratings_before,
        "watchlist_added": len(new_state.get("watchlist_ids") or []) - watchlist_before,
        "ratings_count": len(new_state.get("ratings") or []),
        "watchlist_count": len(new_state.get("watchlist_ids") or []),
        "candidates_count": len(new_state.get("ranked") or []),
    }


# --- public user endpoints (no auth required) ---

@app.get("/api/users/search")
def user_search(q: str = ""):
    if not q:
        return {"users": []}
    return {"users": search_users_by_username(q)}


def _public_profile_response(user_id: int, username: str) -> dict:
    """Build the same response shape as /api/profile for any user."""
    state = _get_or_build_profile(user_id, username)
    if not state:
        raise HTTPException(status_code=404, detail="No profile yet")

    profile_vec = state.get("profile_vec")
    rated_movies = state.get("rated_movies") or []

    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1

    if profile_vec is not None:
        genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))}
        decade_weights = {DECADES[i]: float(profile_vec[len(GENRES) + i]) for i in range(len(DECADES))}
    else:
        genre_weights = {}
        decade_weights = {}

    genres = [
        {"name": g, "count": genre_counts[g], "weight": genre_weights.get(g, 0.0)}
        for g in GENRES if genre_counts[g] > 0
    ]
    genres.sort(key=lambda x: x["weight"], reverse=True)

    ratings = state.get("ratings") or []
    avg_rating = round(sum(ratings) / len(ratings), 1) if ratings else 0.0
    neutral = state.get("neutral", 3.0)
    critic = build_critic_profile(rated_movies, ratings)

    decades = [
        {"name": d, "weight": decade_weights.get(d, 0.0)}
        for d in DECADES
        if decade_weights.get(d, 0.0) > 0
    ]
    tone = compute_axis_scores(rated_movies, ratings, TONE_AXES)
    all_subgenres = compute_axis_scores(
        rated_movies, ratings, state.get("user_subgenre_axes") or SUBGENRE_AXES
    )

    return {
        "letterboxd_username": username,
        "ratings_count": len(ratings),
        "watchlist_count": len(state.get("watchlist_ids") or []),
        "avg_rating": avg_rating,
        "summary": state.get("summary"),
        "genres": genres,
        "decades": decades,
        "tone": tone,
        "subgenres": [s for s in all_subgenres if s["weight"] > 0][:8],
        "critic_alignment": critic["alignment"],
        "quality_floor": round(critic["quality_floor"] - FLOOR_TOLERANCE, 2),
        "neutral": neutral,
    }


@app.get("/api/users/{username}")
def get_public_profile(username: str):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _public_profile_response(user["id"], username)


@app.get("/api/users/{username}/examples")
def get_public_examples(username: str):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user_id = user["id"]
    state = _get_or_build_profile(user_id, username)
    if not state:
        return {"genre": {}, "subgenre": {}}

    rated_movies = state.get("rated_movies") or []
    ratings = state.get("ratings") or []

    def _serialize(m: dict, r: float) -> dict:
        return {
            "id": m["id"],
            "title": m["title"],
            "year": m.get("year"),
            "rating": r,
            "poster_path": (m.get("raw_tmdb") or {}).get("poster_path"),
        }

    def pick_examples(axes: list[str], match_fn) -> dict[str, list[dict]]:
        used_ids: set[int] = set()
        result: dict[str, list[dict]] = {}
        for name in axes:
            candidates = sorted(
                [(m, r) for m, r in zip(rated_movies, ratings)
                 if match_fn(name, m) and m["id"] not in used_ids],
                key=lambda x: x[1], reverse=True,
            )
            for m, r in candidates[:3]:
                used_ids.add(m["id"])
            result[name] = [_serialize(m, r) for m, r in candidates[:3]]
        return result

    profile_vec = state.get("profile_vec")
    genre_weights = {GENRES[i]: float(profile_vec[i]) for i in range(len(GENRES))} if profile_vec is not None else {}
    genre_counts: dict[str, int] = {g: 0 for g in GENRES}
    for movie in rated_movies:
        for g in _genre_names(movie):
            if g in genre_counts:
                genre_counts[g] += 1
    top_genres = sorted(
        [g for g in GENRES if genre_counts.get(g, 0) > 0],
        key=lambda g: genre_weights.get(g, 0.0), reverse=True,
    )[:8]
    genre_ex = pick_examples(top_genres, lambda name, m: name in set(_genre_names(m)))

    user_subgenre_axes = state.get("user_subgenre_axes") or SUBGENRE_AXES
    all_subgenres = compute_axis_scores(rated_movies, ratings, user_subgenre_axes)
    top_subgenres = [s["name"] for s in all_subgenres if s["weight"] > 0][:8]

    def subgenre_match(name: str, m: dict) -> bool:
        kws = set(SUBGENRE_AXES.get(name) or TONE_AXES.get(name) or user_subgenre_axes.get(name) or [])
        return bool(_movie_keywords(m) & kws)

    subgenre_ex = pick_examples(top_subgenres, subgenre_match)

    decade_weights = {DECADES[i]: float(profile_vec[len(GENRES) + i]) for i in range(len(DECADES))} if profile_vec is not None else {}
    active_decades = [d for d in DECADES if decade_weights.get(d, 0.0) > 0]

    def era_match(decade_name: str, m: dict) -> bool:
        raw = m.get("raw_tmdb") or m
        release = (raw.get("release_date", "") or "")
        year = raw.get("year") or (int(release[:4]) if len(release) >= 4 else None)
        if not year:
            return False
        return f"{(year // 10) * 10}s" == decade_name

    era_ex = pick_examples(active_decades, era_match)

    def tone_match(axis_name: str, m: dict) -> bool:
        kws = set(TONE_AXES.get(axis_name, []))
        return bool(_movie_keywords(m) & kws)

    tone_ex = pick_examples(list(TONE_AXES.keys()), tone_match)

    return {"genre": genre_ex, "subgenre": subgenre_ex, "era": era_ex, "tone": tone_ex}


@app.get("/api/users/{username}/history")
def get_public_history(username: str):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    rows = get_recommendation_history(user["id"], limit=20)
    result = []
    for m in rows:
        raw = m.get("raw_tmdb") or {}
        mood = m.get("mood_context") or {}
        mood_filters = mood.get("filters") or {}
        result.append({
            "id": m["id"],
            "movie_id": m["movie_id"],
            "title": m["title"],
            "year": m.get("year"),
            "recommended_at": m.get("recommended_at"),
            "poster_path": raw.get("poster_path"),
            "genres": json.loads(m["genres"]) if isinstance(m.get("genres"), str) else (m.get("genres") or []),
            "runtime": m.get("runtime"),
            "score": m.get("score"),
            "followed_through": bool(m.get("followed_through")),
            "follow_up_rating": m.get("follow_up_rating"),
            "mood_genres": mood_filters.get("required_genres") or [],
            "mood_tone": mood_filters.get("tone"),
        })
    return {"history": result}


# --- admin endpoints ---

@app.get("/api/admin/users")
def admin_list_users(_admin: dict = Depends(get_admin_user)):
    return {"users": get_all_users_with_stats()}


@app.get("/api/admin/themes")
def admin_theme_stats(_admin: dict = Depends(get_admin_user)):
    from collections import Counter
    rows = get_all_keyword_themes_full()
    counts = Counter(r["theme"] for r in rows)
    return {
        "total_keywords": len(rows),
        "total_themes": len(counts),
        "multi_keyword_themes": sum(1 for c in counts.values() if c > 1),
    }


@app.get("/api/admin/themes/breakdown")
def admin_theme_breakdown(_admin: dict = Depends(get_admin_user)):
    """All themes with their keywords, sorted by keyword count descending."""
    from collections import defaultdict
    rows = get_all_keyword_themes_full()
    groups: dict[str, dict] = defaultdict(lambda: {"keywords": [], "sources": {}})
    for r in rows:
        entry = groups[r["theme"]]
        entry["keywords"].append(r["keyword"])
        entry["sources"][r["source"]] = entry["sources"].get(r["source"], 0) + 1
    return {
        "themes": sorted(
            [{"name": name, "count": len(d["keywords"]), "keywords": d["keywords"], "sources": d["sources"]}
             for name, d in groups.items()],
            key=lambda x: x["count"], reverse=True,
        )
    }



@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, _admin: dict = Depends(get_admin_user)):
    delete_user(user_id)
    _user_states.pop(user_id, None)
    return {"deleted": user_id}


@app.post("/api/admin/recluster")
def admin_recluster(_admin: dict = Depends(get_admin_user)):
    """Re-run full co-occurrence + embedding clustering on the catalog."""
    n_themes = build_clusters()
    return {"themes": n_themes}
