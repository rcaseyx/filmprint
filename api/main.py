"""FastAPI recommendation service.

Initializes the full pipeline on startup and caches state in memory.
Recommendation requests are fast — the expensive work (CSV sync, TMDB
enrichment, profile build, ranking) happens once at boot.
"""

from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any
import json
import math
import os
import shutil
import tempfile
import secrets
import time
import zipfile

import datetime
import requests as _requests

import anthropic
import bcrypt
import jwt as pyjwt
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Form, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(override=True)

_anthropic_client = anthropic.Anthropic()

_JWT_SECRET = os.environ.get("JWT_SECRET", "")
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_DAYS = 60
_INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "")
_GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")


def _create_jwt(user_id: int, email: str, username: str | None) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "username": username or "",
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=_JWT_EXPIRE_DAYS),
        "iat": datetime.datetime.now(datetime.timezone.utc),
    }
    return pyjwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def _decode_jwt(token: str) -> dict | None:
    try:
        return pyjwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])
    except pyjwt.InvalidTokenError:
        return None

from filmprint.db import (
    init_db, get_or_create_user_by_email, update_user_username,
    create_user_with_password, verify_user_password,
    get_user_by_id, get_user_by_username, search_users_by_username,
    get_user_ratings, get_user_watchlist,
    get_seen_movie_ids, get_taste_profile, save_taste_profile,
    is_profile_stale, upsert_movie, batch_upsert_movies, update_feature_vector,
    log_recommendation, get_recent_ratings, get_recommendation_history, get_recent_recommendation_ids,
    resolve_recommendation_outcomes, get_recommendation_boosts,
    get_ratings_count, get_watchlist_count, get_all_users, get_all_users_with_stats, get_top_users_by_ratings, delete_user,
    get_all_keyword_themes_full, get_keyword_theme_stats, get_candidate_movies,
    compute_ratings_hash, get_movies_by_ids,
    get_user_by_email,
    create_reset_token, get_reset_token, consume_reset_token,
    is_whitelisted, get_whitelist, add_to_whitelist, remove_from_whitelist,
    get_movie_title_year_index,
    create_beta_request, get_beta_requests, get_beta_request,
    update_beta_request_counts, delete_beta_request,
    get_catalog_keyword_counts,
    get_five_star_ratings,
    upsert_rating,
    get_all_movies_with_vectors,
    get_all_keyword_themes,
)
from filmprint.features import (
    build_feature_vector, taste_summary, build_keyword_vocab,
    build_affinity_scores, GENRES, DECADES, compute_axis_scores, TONE_AXES, SUBGENRE_AXES,
    _movie_keywords, find_unexplored_directors,
    build_theme_axes, find_blind_spot_gaps, _facet_country, _facet_decade,
)
from filmprint.profile import build_taste_profile, build_taste_clusters, build_critic_profile, personal_neutral, PROFILE_VERSION
from filmprint.recommender import rank_watchlist, diversify
from filmprint.discovery import expand_candidates, discover_by_mood
from filmprint.app import ensure_feature_vectors
from filmprint.tmdb import get_watch_providers, get_movie_details as _tmdb_get_movie_details, CACHE_DIR as _TMDB_CACHE_DIR
from filmprint.omdb import get_scores, prime_score_cache
from filmprint.sync import sync_ratings_csv, sync_watchlist_csv, sync_rss, sync_scrape
from filmprint.letterboxd import validate_username, scrape_ratings, scrape_watchlist
from filmprint.themes import assign_new_keywords, build_user_subgenre_axes, backfill_catalog_keywords, load_centroids, build_clusters, _get_model as _get_onnx_model
import requests as _requests

DATA_DIR = Path(__file__).parent.parent / "data"

# Buffer subtracted from the computed quality_floor when enforcing and displaying it.
# Gives under-reviewed films breathing room without changing the floor's derivation.
FLOOR_TOLERANCE = 0.5

# Catalog-wide keyword film counts for TF-IDF vocab scoring — loaded once at startup
_catalog_keyword_counts: dict[str, int] = {}
_total_catalog_films: int = 0
_idf_weights: dict[str, float] = {}

# Per-user pipeline state — backed by Redis, falls back to in-memory dict if unavailable
from filmprint.cache import make_caches as _make_caches, check_rate_limit
_user_states, _user_profile_states, _profile_response_cache, _examples_response_cache = _make_caches()
_public_profile_cache: dict[int, dict] = {}
_public_examples_cache: dict[int, dict] = {}
_rebuild_jobs: dict[int, str] = {}  # user_id → "running" | "done" | "error"

# Per-user lock so concurrent requests don't double-run _rebuild_profile_only
import threading as _threading
_profile_build_locks: dict[int, _threading.Lock] = {}
_profile_build_locks_mutex = _threading.Lock()

# Volume-persisted state files — survive restarts
_STATE_DIR = _TMDB_CACHE_DIR / "states"


def _save_state_to_volume(user_id: int, state: dict) -> None:
    """Write ranking state to the persistent volume so cold restarts skip full rebuild."""
    try:
        _STATE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "ratings_hash": compute_ratings_hash(user_id),
            "profile_version": PROFILE_VERSION,
            "keyword_vocab": state["keyword_vocab"],
            "affinity": state["affinity"],
            "user_subgenre_axes": state["user_subgenre_axes"],
            "ranked": [[m["id"], float(s)] for m, s in state["ranked"]],
            "quality_floor": float(state["quality_floor"]),
            "critic_alignment": float(state["critic_alignment"]),
            "neutral": float(state["neutral"]),
            "summary": state["summary"],
            "ai_summary": state.get("ai_summary"),
        }
        (_STATE_DIR / f"{user_id}.json").write_text(json.dumps(payload))
    except Exception:
        pass  # never let a save failure break a recommendation response


def _restore_state_from_volume(user_id: int, username: str) -> bool:
    """Restore _user_states from a volume-persisted file. Returns True if successful."""
    state_file = _STATE_DIR / f"{user_id}.json"
    if not state_file.exists():
        return False
    try:
        payload = json.loads(state_file.read_text())
    except Exception:
        return False

    if payload.get("profile_version") != PROFILE_VERSION:
        return False
    if payload.get("ratings_hash") != compute_ratings_hash(user_id):
        return False

    ranked_pairs = payload.get("ranked") or []
    if not ranked_pairs:
        return False

    movie_map = get_movies_by_ids([pair[0] for pair in ranked_pairs])
    ranked = [(movie_map[mid], float(score)) for mid, score in ranked_pairs if mid in movie_map]
    if not ranked:
        return False

    # One batch DB query for all OMDB scores so rank_watchlist calls don't hit the DB per movie.
    imdb_ids = [(m.get("raw_tmdb") or m).get("imdb_id") for m, _ in ranked]
    prime_score_cache([iid for iid in imdb_ids if iid])

    profile_data = get_taste_profile(user_id)
    if not profile_data:
        return False

    profile_vec = np.array(profile_data["vector"])
    keyword_vocab = payload["keyword_vocab"]
    user_subgenre_axes = payload.get("user_subgenre_axes") or {}
    expected_dim = 35 + len(keyword_vocab) + 2 + len(user_subgenre_axes) + len(TONE_AXES)
    if len(profile_vec) != expected_dim:
        # Volume file and DB profile are out of sync (e.g. _rebuild_profile_only ran
        # after the last volume save and changed the feature space). Force a full rebuild.
        return False

    _user_states[user_id] = {
        "user_id": user_id,
        "username": username,
        "rated_movies": [],
        "ratings": [],
        "profile_vec": profile_vec,
        "clusters": [np.array(c) for c in profile_data.get("clusters") or []],
        "keyword_vocab": keyword_vocab,
        "affinity": payload["affinity"],
        "ranked": ranked,
        "watchlist_ids": {m["id"] for m in get_user_watchlist(user_id)},
        "seen_ids": get_seen_movie_ids(user_id),
        "session_recommended_ids": set(),
        "quality_floor": payload["quality_floor"],
        "critic_alignment": payload["critic_alignment"],
        "neutral": payload["neutral"],
        "summary": payload["summary"],
        "ai_summary": payload.get("ai_summary"),
        "user_subgenre_axes": user_subgenre_axes,
    }
    return True


def _above_floor(movie: dict, quality_floor: float) -> bool:
    va = movie.get("vote_average") or 0
    return va == 0 or va >= quality_floor  # pass through if no votes yet


def _available_at_home(movie: dict) -> bool:
    raw = movie.get("raw_tmdb") or movie
    release_str = (raw.get("release_date") or "")[:10]
    if len(release_str) < 10:
        return True
    try:
        days_old = (datetime.date.today() - datetime.date.fromisoformat(release_str)).days
    except ValueError:
        return True
    if days_old > 90:
        return True
    return len(get_watch_providers(movie["id"])) > 0


def _rebuild_state(user_id: int, username: str) -> None:
    """Rebuild profile and ranking from whatever is currently in the DB. No sync."""
    t0 = time.time()
    print(f"[rebuild_state] starting for user {user_id}", flush=True)
    resolve_recommendation_outcomes(user_id)
    outcome_boosts = get_recommendation_boosts(user_id)

    rated_rows = get_user_ratings(user_id)
    ratings = [r["letterboxd_rating"] for r in rated_rows]
    print(f"[rebuild_state] user {user_id}: {len(rated_rows)} ratings loaded", flush=True)

    t1 = time.time()
    rated_movies = ensure_feature_vectors(list(rated_rows), label="rebuild_state/rated")
    print(f"[rebuild_state] rated movies vectorized in {time.time()-t1:.1f}s", flush=True)

    keyword_vocab = build_keyword_vocab(rated_movies, catalog_counts=_catalog_keyword_counts, total_catalog_films=_total_catalog_films)
    assign_new_keywords(keyword_vocab)
    user_subgenre_axes = build_user_subgenre_axes(keyword_vocab)
    affinity = build_affinity_scores(rated_movies, ratings)

    stale = is_profile_stale(user_id, PROFILE_VERSION)

    imdb_ids = [m.get("raw_tmdb", {}).get("imdb_id") or m.get("imdb_id") for m in rated_movies]
    prime_score_cache([iid for iid in imdb_ids if iid])

    t1 = time.time()
    if stale:
        profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes, idf=_idf_weights)
        clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes, idf=_idf_weights)
        save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                           [c.tolist() for c in clusters])
    else:
        profile_data = get_taste_profile(user_id)
        profile_vec = np.array(profile_data["vector"])
        clusters = [np.array(c) for c in profile_data.get("clusters") or []]
        expected_len = 35 + len(keyword_vocab) + 2 + len(user_subgenre_axes) + len(TONE_AXES)
        if len(profile_vec) != expected_len:
            stale = True
            profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes, idf=_idf_weights)
            clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes, idf=_idf_weights)
            save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                               [c.tolist() for c in clusters])
    print(f"[rebuild_state] profile built in {time.time()-t1:.1f}s (stale={stale})", flush=True)

    seen_ids = get_seen_movie_ids(user_id)
    watchlist = ensure_feature_vectors(get_user_watchlist(user_id), label="rebuild_state/watchlist")
    watchlist_ids = {m["id"] for m in watchlist}

    if stale:
        raw_rated = [m.get("raw_tmdb") or m for m in rated_movies]
        # Pre-fetch all known raw_tmdb from DB so expand_candidates can skip TMDB API
        # calls for movies we already have. Matters most on cold starts after a restart.
        t1 = time.time()
        all_known_raw = {m["id"]: m["raw_tmdb"] for m in get_candidate_movies(set(), limit=2000)}
        print(f"[rebuild_state] loaded {len(all_known_raw)} known movies in {time.time()-t1:.1f}s", flush=True)
        t1 = time.time()
        discovered_raw = expand_candidates(raw_rated, ratings, seen_ids, known_raw=all_known_raw)
        print(f"[rebuild_state] expand_candidates returned {len(discovered_raw)} in {time.time()-t1:.1f}s", flush=True)
        t1 = time.time()
        batch_upsert_movies(discovered_raw)
        print(f"[rebuild_state] batch upserted {len(discovered_raw)} movies in {time.time()-t1:.1f}s", flush=True)
        stored = get_movies_by_ids([d["id"] for d in discovered_raw])
        discovered = ensure_feature_vectors(
            [{**d, "raw_tmdb": d, "feature_vector": stored.get(d["id"], {}).get("feature_vector")} for d in discovered_raw],
            label="rebuild_state/discovered",
        )
    else:
        discovered = get_candidate_movies(seen_ids | watchlist_ids)

    critic = build_critic_profile(rated_movies, ratings)
    quality_floor = critic["quality_floor"]

    all_candidates = (
        [m for m in watchlist if m["id"] not in seen_ids and _above_floor(m, quality_floor) and _available_at_home(m)]
        + [d for d in discovered if d["id"] not in watchlist_ids and _above_floor(d, quality_floor) and _available_at_home(d)]
    )

    # One batch DB query for all OMDB scores so rank_watchlist doesn't hit the DB per movie.
    imdb_ids = [(m.get("raw_tmdb") or m).get("imdb_id") for m in all_candidates]
    prime_score_cache([iid for iid in imdb_ids if iid])

    t1 = time.time()
    ranked = rank_watchlist(profile_vec, all_candidates, keyword_vocab, affinity, user_subgenre_axes, clusters=clusters, idf=_idf_weights)
    print(f"[rebuild_state] ranked {len(ranked)} candidates in {time.time()-t1:.1f}s", flush=True)

    summary = taste_summary(profile_vec, keyword_vocab, user_subgenre_axes)

    t1 = time.time()
    full_catalog = get_all_movies_with_vectors()
    director_suggestions = _build_director_suggestions(
        rated_movies, full_catalog, profile_vec, keyword_vocab, affinity, user_subgenre_axes, clusters,
        seen_ids, watchlist_ids, quality_floor, summary,
    )
    print(f"[rebuild_state] director suggestions built in {time.time()-t1:.1f}s ({len(director_suggestions)} found)", flush=True)

    t1 = time.time()
    blind_spot_suggestions = _build_blind_spot_suggestions(
        rated_movies, ratings, full_catalog, profile_vec, keyword_vocab, affinity, user_subgenre_axes, clusters,
        seen_ids, watchlist_ids, quality_floor, summary,
    )
    print(f"[rebuild_state] blind spot suggestions built in {time.time()-t1:.1f}s ({len(blind_spot_suggestions)} found)", flush=True)

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
        "summary": summary,
        "ai_summary": generate_ai_summary(profile_vec, keyword_vocab, user_subgenre_axes, affinity, rated_movies, ratings, critic["alignment"], critic["neutral"]),
        "user_subgenre_axes": user_subgenre_axes,
        "director_suggestions": director_suggestions,
        "shown_director_suggestion_ids": set(),
        "blind_spot_suggestions": blind_spot_suggestions,
        "shown_blind_spot_suggestion_ids": set(),
    }
    _save_state_to_volume(user_id, _user_states[user_id])
    # Full state supersedes the lightweight profile-only cache
    _user_profile_states.pop(user_id, None)
    _profile_response_cache.pop(user_id, None)
    _examples_response_cache.pop(user_id, None)
    _public_profile_cache.pop(user_id, None)
    _public_examples_cache.pop(user_id, None)
    print(f"[rebuild_state] done for user {user_id} in {time.time()-t0:.1f}s (stale={stale})", flush=True)


def _rebuild_profile_only(user_id: int, username: str) -> None:
    """Build and cache profile state without candidate discovery.

    Significantly faster than _rebuild_state — only hits the DB and runs pure
    computation. Used by profile/genres endpoints that don't need ranked candidates.
    """
    t0 = time.time()
    print(f"[rebuild_profile_only] starting for user {user_id}", flush=True)
    resolve_recommendation_outcomes(user_id)
    outcome_boosts = get_recommendation_boosts(user_id)

    rated_rows = get_user_ratings(user_id)
    ratings = [r["letterboxd_rating"] for r in rated_rows]

    # Check staleness before deciding whether to call ensure_feature_vectors.
    # build_keyword_vocab and build_affinity_scores only use raw_tmdb, not feature
    # vectors, so we can skip the expensive TMDB fetch on the common non-stale path.
    stale = is_profile_stale(user_id, PROFILE_VERSION)

    if stale:
        rated_movies = ensure_feature_vectors(list(rated_rows))
        keyword_vocab = build_keyword_vocab(rated_movies, catalog_counts=_catalog_keyword_counts, total_catalog_films=_total_catalog_films)
        assign_new_keywords(keyword_vocab)
        user_subgenre_axes = build_user_subgenre_axes(keyword_vocab)
        affinity = build_affinity_scores(rated_movies, ratings)
        profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes, idf=_idf_weights)
        clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, outcome_boosts, user_subgenre_axes, idf=_idf_weights)
        save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                           [c.tolist() for c in clusters])
        (_STATE_DIR / f"{user_id}.json").unlink(missing_ok=True)
        _user_states.pop(user_id, None)
    else:
        rated_movies = list(rated_rows)
        keyword_vocab = build_keyword_vocab(rated_movies, catalog_counts=_catalog_keyword_counts, total_catalog_films=_total_catalog_films)
        assign_new_keywords(keyword_vocab)
        user_subgenre_axes = build_user_subgenre_axes(keyword_vocab)
        affinity = build_affinity_scores(rated_movies, ratings)
        profile_data = get_taste_profile(user_id)
        profile_vec = np.array(profile_data["vector"])
        clusters = [np.array(c) for c in profile_data.get("clusters") or []]
        expected_len = 35 + len(keyword_vocab) + 2 + len(user_subgenre_axes) + len(TONE_AXES)
        if len(profile_vec) != expected_len:
            rated_movies = ensure_feature_vectors(rated_movies)
            profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes, idf=_idf_weights)
            clusters = build_taste_clusters(rated_movies, ratings, keyword_vocab, affinity, subgenre_axes=user_subgenre_axes, idf=_idf_weights)
            save_taste_profile(user_id, profile_vec.tolist(), len(ratings), PROFILE_VERSION,
                               [c.tolist() for c in clusters])
            (_STATE_DIR / f"{user_id}.json").unlink(missing_ok=True)
            _user_states.pop(user_id, None)

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
        "ai_summary": generate_ai_summary(profile_vec, keyword_vocab, user_subgenre_axes, affinity, rated_movies, ratings, critic["alignment"], critic["neutral"]),
        "user_subgenre_axes": user_subgenre_axes,
    }
    _profile_response_cache.pop(user_id, None)
    _examples_response_cache.pop(user_id, None)
    _public_profile_cache.pop(user_id, None)
    _public_examples_cache.pop(user_id, None)
    print(f"[rebuild_profile_only] done for user {user_id} in {time.time()-t0:.1f}s", flush=True)


def _prewarm_profile_cache(user_id: int, username: str) -> None:
    """Build profile display state for a volume-restored user without risking rec state eviction.

    Unlike _rebuild_profile_only, this never calls assign_new_keywords (handled by
    backfill_catalog_keywords at startup) and never touches _user_states. If the stored
    profile vector has a dimension mismatch, we skip caching — the profile endpoint will
    trigger a proper rebuild on first request.
    """
    t0 = time.time()
    rated_rows = get_user_ratings(user_id)
    if not rated_rows:
        return
    print(f"[prewarm] user {user_id}: loaded {len(rated_rows)} ratings in {time.time()-t0:.1f}s", flush=True)
    t1 = time.time()
    ratings = [r["letterboxd_rating"] for r in rated_rows]
    rated_movies = list(rated_rows)

    keyword_vocab = build_keyword_vocab(rated_movies, catalog_counts=_catalog_keyword_counts, total_catalog_films=_total_catalog_films)
    user_subgenre_axes = build_user_subgenre_axes(keyword_vocab)
    affinity = build_affinity_scores(rated_movies, ratings)
    print(f"[prewarm] user {user_id}: vocab/axes/affinity in {time.time()-t1:.1f}s", flush=True)
    t1 = time.time()

    profile_data = get_taste_profile(user_id)
    if not profile_data:
        return
    profile_vec = np.array(profile_data["vector"])
    expected_len = 35 + len(keyword_vocab) + 2 + len(user_subgenre_axes) + len(TONE_AXES)
    if len(profile_vec) != expected_len:
        print(f"[prewarm] dim mismatch for user {user_id}: {len(profile_vec)} vs {expected_len} — skipping cache", flush=True)
        return

    # Reuse watchlist_ids and seen_ids already loaded by _restore_state_from_volume —
    # avoids re-fetching large movie JOIN just to get IDs we already have in memory.
    vol_state = _user_states.get(user_id, {})
    watchlist_ids = vol_state.get("watchlist_ids") or {m["id"] for m in get_user_watchlist(user_id)}
    seen_ids = vol_state.get("seen_ids") or get_seen_movie_ids(user_id)
    critic = build_critic_profile(rated_movies, ratings)
    print(f"[prewarm] user {user_id}: profile/watchlist/critic in {time.time()-t1:.1f}s", flush=True)
    t1 = time.time()

    _user_profile_states[user_id] = {
        "user_id": user_id,
        "username": username,
        "rated_movies": rated_movies,
        "ratings": ratings,
        "profile_vec": profile_vec,
        "clusters": [np.array(c) for c in profile_data.get("clusters") or []],
        "keyword_vocab": keyword_vocab,
        "affinity": affinity,
        "watchlist_ids": watchlist_ids,
        "seen_ids": seen_ids,
        "quality_floor": critic["quality_floor"],
        "critic_alignment": critic["alignment"],
        "neutral": critic["neutral"],
        "summary": taste_summary(profile_vec, keyword_vocab, user_subgenre_axes),
        "ai_summary": vol_state.get("ai_summary"),
        "user_subgenre_axes": user_subgenre_axes,
    }
    t1 = time.time()
    _build_profile_response(user_id, _user_profile_states[user_id])
    _build_examples_response(user_id, _user_profile_states[user_id])
    print(f"[prewarm] user {user_id}: response cache build in {time.time()-t1:.1f}s", flush=True)
    print(f"[prewarm] profile cache warmed for user {user_id} in {time.time()-t0:.1f}s", flush=True)


def _get_or_build_profile(user_id: int, username: str) -> dict:
    """Return profile state — uses full state if already built, otherwise fast profile-only path.

    Volume-restored states have rated_movies=[] intentionally (not needed for recs), so we
    can't use them for profile display. Fall through to the profile-only rebuild in that case.
    """
    if _rebuild_jobs.get(user_id) == "running":
        return _user_states.get(user_id, {}) or _user_profile_states.get(user_id, {})
    state = _user_states.get(user_id)
    if state and state.get("rated_movies"):
        return state
    if user_id not in _user_profile_states and get_ratings_count(user_id) > 0:
        with _profile_build_locks_mutex:
            if user_id not in _profile_build_locks:
                _profile_build_locks[user_id] = _threading.Lock()
            lock = _profile_build_locks[user_id]
        with lock:
            if user_id not in _user_profile_states:
                _rebuild_profile_only(user_id, username)
    return _user_profile_states.get(user_id, {})


def _get_or_build_state(user_id: int, username: str) -> dict:
    """Return cached state for user, building it lazily if they have data in the DB."""
    if _rebuild_jobs.get(user_id) == "running":
        return _user_states.get(user_id, {})
    if user_id not in _user_states and username and get_ratings_count(user_id) > 0:
        if not _restore_state_from_volume(user_id, username):
            _rebuild_state(user_id, username)
    return _user_states.get(user_id, {})


def _run_rebuild_background(user_id: int, username: str) -> None:
    """Background task: rebuild state only (e.g. after in-app ratings)."""
    try:
        _rebuild_state(user_id, username)
        _rebuild_jobs[user_id] = "done"
    except Exception:
        _rebuild_jobs[user_id] = "error"
        raise


def _run_sync_background(user_id: int, username: str) -> None:
    """Background task: scrape Letterboxd then rebuild state."""
    try:
        sync_rss(user_id, username)
        sync_scrape(user_id, username)
        _rebuild_state(user_id, username)
        _rebuild_jobs[user_id] = "done"
    except Exception:
        _rebuild_jobs[user_id] = "error"
        raise


def _run_import_background(user_id: int, username: str, tmp_dir: str) -> None:
    """Background task: ingest CSV files from tmp_dir, then rebuild state."""
    try:
        tmp = Path(tmp_dir)
        db_index = get_movie_title_year_index()
        ratings_csv = next(tmp.rglob("ratings.csv"), None)
        watchlist_csv = next(tmp.rglob("watchlist.csv"), None)
        if ratings_csv:
            sync_ratings_csv(user_id, str(ratings_csv), db_index)
        if watchlist_csv:
            sync_watchlist_csv(user_id, str(watchlist_csv), db_index)
        _rebuild_state(user_id, username)
        _rebuild_jobs[user_id] = "done"
    except Exception:
        _rebuild_jobs[user_id] = "error"
        raise
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import threading
    global _catalog_keyword_counts, _total_catalog_films, _idf_weights
    init_db(seed_data=SUBGENRE_AXES)
    load_centroids()  # fast: loads existing themes so requests work immediately
    _catalog_keyword_counts, _total_catalog_films = get_catalog_keyword_counts()
    print(f"[startup] catalog keyword counts loaded: {len(_catalog_keyword_counts)} keywords, {_total_catalog_films} films", flush=True)
    if _catalog_keyword_counts and _total_catalog_films > 0:
        import math as _math
        raw_idf = {
            kw: _math.log((_total_catalog_films + 1) / (count + 1))
            for kw, count in _catalog_keyword_counts.items()
        }
        max_idf = max(raw_idf.values()) if raw_idf else 1.0
        _idf_weights = {kw: score / max_idf for kw, score in raw_idf.items()}
    print(f"[startup] IDF weights computed: {len(_idf_weights)} keywords", flush=True)

    def _prewarm():
        import threading as _t
        try:
            t_model = time.time()
            print("[prewarm] loading ONNX model...", flush=True)
            _get_onnx_model()
            print(f"[prewarm] ONNX model ready in {time.time()-t_model:.1f}s", flush=True)

            def _run_backfill():
                try:
                    print("[prewarm] backfill_catalog_keywords starting...", flush=True)
                    t = time.time()
                    n = backfill_catalog_keywords()
                    print(f"[prewarm] backfill_catalog_keywords done in {time.time()-t:.1f}s — {n} themes", flush=True)
                except Exception as e:
                    print(f"[prewarm] backfill_catalog_keywords failed: {e}", flush=True)

            _t.Thread(target=_run_backfill, daemon=True).start()

            users = [u for u in get_all_users_with_stats() if u.get("ratings_count", 0) > 0]
            print(f"[prewarm] starting — {len(users)} user(s) to warm", flush=True)
            t0 = time.time()
            counters = {"restored": 0, "rebuilt": 0, "failed": 0, "skipped": 0}
            counter_lock = _t.Lock()

            def _warm_one(user):
                uid = user["id"]
                uname = user.get("letterboxd_username") or ""
                if uid in _user_states:
                    with counter_lock:
                        counters["skipped"] += 1
                    return
                try:
                    if _restore_state_from_volume(uid, uname):
                        # Build profile cache without risking eviction of the restored rec state.
                        _prewarm_profile_cache(uid, uname)
                        with counter_lock:
                            counters["restored"] += 1
                    else:
                        _rebuild_profile_only(uid, uname)
                        state = _user_profile_states.get(uid)
                        if state:
                            _build_profile_response(uid, state)
                            _build_examples_response(uid, state)
                        with counter_lock:
                            counters["rebuilt"] += 1
                except Exception as e:
                    print(f"[prewarm] failed for user {uid} ({uname}): {e}", flush=True)
                    with counter_lock:
                        counters["failed"] += 1

            with ThreadPoolExecutor(max_workers=min(len(users) or 1, 4)) as pool:
                list(pool.map(_warm_one, users))

            print(
                f"[prewarm] done in {time.time()-t0:.1f}s — "
                f"{counters['restored']} restored, {counters['rebuilt']} rebuilt, "
                f"{counters['skipped']} skipped (already in cache), {counters['failed']} failed",
                flush=True,
            )

            # Return pages freed during prewarm back to the OS. Python's ptmalloc
            # allocator holds on to freed heap pages indefinitely — malloc_trim
            # flushes them. Only meaningful on Linux/glibc (Railway); no-ops elsewhere.
            try:
                import ctypes
                ctypes.CDLL("libc.so.6").malloc_trim(0)
                print("[prewarm] malloc_trim complete", flush=True)
            except Exception:
                pass
        except Exception as e:
            print(f"[prewarm] fatal error: {e}", flush=True)

    threading.Thread(target=_prewarm, daemon=True).start()
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
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    payload = _decode_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return {
        "user_id": int(payload["sub"]),
        "username": payload.get("username", ""),
        "email": payload.get("email", ""),
    }


_ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")


async def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    if not _ADMIN_EMAIL or current_user["email"] != _ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    return current_user


async def get_admin_or_internal(request: Request) -> dict:
    """Accept either a JWT admin token or X-Internal-Secret header (for server-to-server calls)."""
    if _INTERNAL_SECRET and request.headers.get("X-Internal-Secret") == _INTERNAL_SECRET:
        return {"user_id": 0, "email": _ADMIN_EMAIL, "username": "internal"}
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    payload = _decode_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    email = payload.get("email", "")
    if not _ADMIN_EMAIL or email != _ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"user_id": int(payload["sub"]), "username": payload.get("username", ""), "email": email}


# --- schemas ---

class MoodContext(BaseModel):
    required_genres: list[str] = []
    exclude_genres: list[str] = []
    max_runtime: int | None = None
    tone: str | None = None        # "light" | "dark"
    pacing: str | None = None      # "slow" | "fast"
    familiarity: str | None = None # "familiar" | "challenging"
    free_text: str | None = None
    niche: bool | None = None      # True → hidden gems / popularity penalty


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
    idf: dict | None = None,
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
    mood_dir = build_feature_vector(synthetic_movie, keyword_vocab, subgenre_axes=subgenre_axes, idf=idf)
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


def generate_ai_summary(
    profile_vec: np.ndarray,
    keyword_vocab: list[str],
    user_subgenre_axes: dict,
    affinity: dict,
    rated_movies: list[dict],
    ratings: list[float],
    critic_alignment: float,
    neutral: float,
) -> str | None:
    """Generate a 2–3 sentence human-readable taste summary using Claude."""
    try:
        avg_rating = round(sum(ratings) / len(ratings), 1) if ratings else 0.0
        ratings_count = len(ratings)

        top_genres = sorted(
            [(GENRES[i], float(profile_vec[i])) for i in range(len(GENRES)) if float(profile_vec[i]) > 0],
            key=lambda x: x[1], reverse=True
        )[:5]

        top_decades = sorted(
            [(DECADES[i], float(profile_vec[len(GENRES) + i])) for i in range(len(DECADES)) if float(profile_vec[len(GENRES) + i]) > 0],
            key=lambda x: x[1], reverse=True
        )[:3]

        tone_scores = compute_axis_scores(rated_movies, ratings, TONE_AXES)
        top_tone = [t["name"] for t in tone_scores if t["weight"] > 0.1][:3]

        subgenre_scores = compute_axis_scores(rated_movies, ratings, user_subgenre_axes or SUBGENRE_AXES)
        top_subgenres = [s["name"] for s in subgenre_scores if s["weight"] > 0.1][:3]

        director_scores = (affinity or {}).get("directors", {})
        director_counts: dict[str, int] = {}
        for movie in rated_movies:
            raw = (movie.get("raw_tmdb") or movie)
            for p in (raw.get("credits") or {}).get("crew", []):
                if p.get("job") == "Director":
                    n = p["name"]
                    director_counts[n] = director_counts.get(n, 0) + 1
        top_directors = sorted(
            [n for n, score in director_scores.items() if score > neutral and director_counts.get(n, 0) >= 2],
            key=lambda n: director_scores[n], reverse=True
        )[:5]

        top_keywords = keyword_vocab[:10]

        a = critic_alignment
        if a > 0.75:
            critic_line = f"more generous than critics by ~{abs(a/2):.1f}★"
        elif a < -0.75:
            critic_line = f"tougher than critics by ~{abs(a/2):.1f}★"
        else:
            critic_line = "roughly in sync with critics"

        context = f"""Genres: {', '.join(g for g, _ in top_genres)}
Eras: {', '.join(d for d, _ in top_decades)}
Tone: {', '.join(top_tone) or 'mixed'}
Subgenres: {', '.join(top_subgenres) or 'varied'}
Favorite directors (2+ films, above avg): {', '.join(top_directors) or 'none clear yet'}
Signature keywords: {', '.join(top_keywords)}
Avg rating: {avg_rating}★ across {ratings_count} films
Critic alignment: {critic_line}"""

        prompt = f"""You're writing a taste profile for a film enthusiast. Be specific and honest — no clichés like "passion for" or "love of cinema".

Their data:
{context}

Write in second person with correct grammar ("You gravitate", "You tend", "You prefer" — not "You gravitates"). 2–3 sentences. No line breaks."""

        response = _anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return " ".join(response.content[0].text.strip().splitlines())
    except Exception as e:
        print(f"[generate_ai_summary] failed: {e}", flush=True)
        return None


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
    if mood.niche:
        parts.append("Prefer lesser-known, under-seen films — avoid obvious mainstream picks")
    if mood.free_text:
        parts.append(mood.free_text)
    return ". ".join(parts) if parts else "No specific mood preference."


def _format_pick_card(movie: dict, score: float, reason: str, watchlist_ids: set) -> dict:
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


def _explain_recommendations(
    top_movies: list[tuple[dict, float]],
    mood_summary: str,
    active_summary: str,
    watchlist_ids: set,
) -> list[dict]:
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

    response = _anthropic_client.messages.create(
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
        return _format_pick_card(movie, score, reason, watchlist_ids)

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_enrich, args): i for i, args in enumerate(selected)}
        ordered = [None] * len(selected)
        for future in as_completed(futures):
            ordered[futures[future]] = future.result()

    return [p for p in ordered if p is not None]


def _explain_director_picks(
    director_top: list[tuple[str, dict, float, int]],
    active_summary: str,
    watchlist_ids: set,
) -> list[dict]:
    """Given (director, film, score, catalog_film_count) tuples where the film is
    already chosen as that director's best entry point by taste score, write one
    reason per director explaining why it's a good place to start."""
    if not director_top:
        return []

    movie_list = "\n".join(
        "[{idx}] {director} — {title} ({year}) — taste score: {score:.2f} | genres: {genres} | runtime: {runtime}min | TMDB rating: {rating}".format(
            idx=i,
            director=director,
            title=movie["title"],
            year=movie.get("year") or (movie.get("release_date", "") or "")[:4],
            score=score,
            genres=", ".join(_genre_names(movie)),
            runtime=movie.get("runtime") or "?",
            rating=movie.get("vote_average", "?"),
        )
        for i, (director, movie, score, _count) in enumerate(director_top)
    )

    prompt = f"""You are a knowledgeable film friend helping someone explore directors they haven't seen much of.

The user's taste profile (used for ranking only — do not quote these labels or treat them as stated preferences):
{active_summary}

For each director below, the film listed is already chosen as the best entry point based on their taste. Write one reason per director explaining why this specific film is a strong place to start with that director's work.

Directors and entry-point films (indexed for your response):
{movie_list}

Return ONLY a JSON array, no other text:
[
  {{"idx": 0, "reason": "one or two sentences — specific to this film and why it suits their taste as a first film by this director"}},
  ...
]

For each reason:
- Ground it in what you actually know about the film (genre, tone, style, themes)
- Frame it as an entry point into the director's work, not a generic recommendation
- Do NOT reference taste profile labels or invent preferences they didn't mention"""

    response = _anthropic_client.messages.create(
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
        if idx >= len(director_top):
            continue
        director, movie, score, count = director_top[idx]
        selected.append((director, movie, score, count, item["reason"]))

    def _enrich(args):
        director, movie, score, count, reason = args
        card = _format_pick_card(movie, score, reason, watchlist_ids)
        card["director"] = director
        card["catalog_film_count"] = count
        return card

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_enrich, args): i for i, args in enumerate(selected)}
        ordered = [None] * len(selected)
        for future in as_completed(futures):
            ordered[futures[future]] = future.result()

    return [p for p in ordered if p is not None]


def _build_director_suggestions(
    rated_movies: list[dict],
    catalog: list[dict],
    profile_vec: np.ndarray,
    keyword_vocab: list[str],
    affinity: dict,
    user_subgenre_axes: dict,
    clusters: list,
    seen_ids: set,
    watchlist_ids: set,
    quality_floor: float,
    active_summary: str,
    top_n: int = 5,
) -> list[dict]:
    """Find directors the user has barely explored (>=3 catalog films, 0 rated by
    the user) and rank each director's best unwatched film by the user's overall
    taste profile. Computed once at profile rebuild time, not per-request."""
    director_map = find_unexplored_directors(rated_movies, catalog)
    if not director_map:
        return []

    flattened = []
    flattened_ids = set()
    for movies in director_map.values():
        for m in movies:
            if m["id"] in seen_ids or m["id"] in flattened_ids:
                continue
            if not _above_floor(m, quality_floor) or not _available_at_home(m):
                continue
            flattened_ids.add(m["id"])
            flattened.append(m)

    if not flattened:
        return []

    scored = rank_watchlist(profile_vec, flattened, keyword_vocab, affinity, user_subgenre_axes, clusters=clusters, idf=_idf_weights)
    score_by_id = {m["id"]: (m, s) for m, s in scored}

    best_per_director = []
    for director, movies in director_map.items():
        candidates = [score_by_id[m["id"]] for m in movies if m["id"] in score_by_id]
        if not candidates:
            continue
        best_movie, best_score = max(candidates, key=lambda x: x[1])
        best_per_director.append((director, best_movie, best_score, len(movies)))

    best_per_director.sort(key=lambda x: x[2], reverse=True)
    pool_max = best_per_director[0][2]
    pool_min = best_per_director[-1][2]
    pool_spread = (pool_max - pool_min) or 1.0
    top_directors = best_per_director[:top_n]

    picks = _explain_director_picks(top_directors, active_summary, watchlist_ids)
    for pick in picks:
        pick["match_pct"] = round(65 + ((pick["score"] - pool_min) / pool_spread) * 34)
    return picks


MIN_RATINGS_FOR_BLIND_SPOTS = 20


def _explain_blind_spot_picks(
    gap_top: list[tuple[str, str, dict, float, int]],
    active_summary: str,
    watchlist_ids: set,
) -> list[dict]:
    """Given (gap_type, gap_label, film, score, catalog_film_count) tuples where
    the film is already chosen as the best match for that gap by taste score,
    write one reason per pick explaining why it's a good way to close that gap."""
    if not gap_top:
        return []

    movie_list = "\n".join(
        "[{idx}] {gap_type}: {gap_label} — {title} ({year}) — taste score: {score:.2f} | genres: {genres} | runtime: {runtime}min | TMDB rating: {rating}".format(
            idx=i,
            gap_type=gap_type,
            gap_label=gap_label,
            title=movie["title"],
            year=movie.get("year") or (movie.get("release_date", "") or "")[:4],
            score=score,
            genres=", ".join(_genre_names(movie)),
            runtime=movie.get("runtime") or "?",
            rating=movie.get("vote_average", "?"),
        )
        for i, (gap_type, gap_label, movie, score, _count) in enumerate(gap_top)
    )

    prompt = f"""You are a knowledgeable film friend helping someone find the gaps in their own taste.

The user's taste profile (used for ranking only — do not quote these labels or treat them as stated preferences):
{active_summary}

Each row below pairs a category the user has barely explored (a country of origin or a decade) with a film that strongly matches taste they've already shown elsewhere. Write one reason per row explaining the gap and why this specific film is a good way to close it — e.g. "you gravitate toward slow-burn psychological films, but you've barely touched South Korean cinema — this is a strong place to start."

Rows (indexed for your response):
{movie_list}

Return ONLY a JSON array, no other text:
[
  {{"idx": 0, "reason": "one or two sentences — name the taste gap and why this film specifically fits"}},
  ...
]

For each reason:
- Ground it in what you actually know about the film (genre, tone, style, themes)
- Name the specific gap (the country or decade) naturally, don't just say "category"
- Do NOT reference taste profile labels or invent preferences they didn't mention"""

    response = _anthropic_client.messages.create(
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
        if idx >= len(gap_top):
            continue
        gap_type, gap_label, movie, score, count = gap_top[idx]
        selected.append((gap_type, gap_label, movie, score, count, item["reason"]))

    def _enrich(args):
        gap_type, gap_label, movie, score, count, reason = args
        card = _format_pick_card(movie, score, reason, watchlist_ids)
        card["gap_type"] = gap_type
        card["gap_label"] = gap_label
        card["catalog_film_count"] = count
        return card

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_enrich, args): i for i, args in enumerate(selected)}
        ordered = [None] * len(selected)
        for future in as_completed(futures):
            ordered[futures[future]] = future.result()

    return [p for p in ordered if p is not None]


def _build_blind_spot_suggestions(
    rated_movies: list[dict],
    ratings: list[float],
    catalog: list[dict],
    profile_vec: np.ndarray,
    keyword_vocab: list[str],
    affinity: dict,
    user_subgenre_axes: dict,
    clusters: list,
    seen_ids: set,
    watchlist_ids: set,
    quality_floor: float,
    active_summary: str,
    top_n: int = 5,
) -> list[dict]:
    """Find gaps (country of origin, decade) in categories that strongly match
    the user's top taste axes, and rank the best unwatched film per gap by the
    user's overall taste profile. Computed once at profile rebuild time, not
    per-request."""
    if len(ratings) < MIN_RATINGS_FOR_BLIND_SPOTS:
        return []

    combined_axes = {**TONE_AXES, **(user_subgenre_axes or SUBGENRE_AXES), **build_theme_axes(get_all_keyword_themes())}
    axis_scores = compute_axis_scores(rated_movies, ratings, combined_axes)
    top_axes = [a["name"] for a in axis_scores[:2] if a["weight"] > 0]
    if not top_axes:
        return []

    gap_map: dict[tuple[str, str], list[dict]] = {}
    for gap_type, facet_fn in (("country", _facet_country), ("decade", _facet_decade)):
        for value, movies in find_blind_spot_gaps(rated_movies, catalog, top_axes, combined_axes, facet_fn).items():
            gap_map[(gap_type, value)] = movies

    if not gap_map:
        return []

    flattened = []
    flattened_ids = set()
    for movies in gap_map.values():
        for m in movies:
            if m["id"] in seen_ids or m["id"] in flattened_ids:
                continue
            if not _above_floor(m, quality_floor) or not _available_at_home(m):
                continue
            flattened_ids.add(m["id"])
            flattened.append(m)

    if not flattened:
        return []

    scored = rank_watchlist(profile_vec, flattened, keyword_vocab, affinity, user_subgenre_axes, clusters=clusters, idf=_idf_weights)
    score_by_id = {m["id"]: (m, s) for m, s in scored}

    best_per_gap = []
    for (gap_type, gap_value), movies in gap_map.items():
        candidates = [score_by_id[m["id"]] for m in movies if m["id"] in score_by_id]
        if not candidates:
            continue
        best_movie, best_score = max(candidates, key=lambda x: x[1])
        if gap_type == "country":
            countries = (best_movie.get("raw_tmdb") or {}).get("production_countries") or []
            gap_label = next((c["name"] for c in countries if c.get("iso_3166_1") == gap_value), gap_value)
        else:
            gap_label = gap_value
        best_per_gap.append((gap_type, gap_label, best_movie, best_score, len(movies)))

    if not best_per_gap:
        return []

    best_per_gap.sort(key=lambda x: x[3], reverse=True)
    pool_max = best_per_gap[0][3]
    pool_min = best_per_gap[-1][3]
    pool_spread = (pool_max - pool_min) or 1.0
    top_gaps = best_per_gap[:top_n]

    picks = _explain_blind_spot_picks(top_gaps, active_summary, watchlist_ids)
    for pick in picks:
        pick["match_pct"] = round(65 + ((pick["score"] - pool_min) / pool_spread) * 34)
    return picks


# --- auth endpoints (no Bearer token required) ---

class CredentialsPayload(BaseModel):
    email: str
    password: str


class ExchangePayload(BaseModel):
    email: str


class GoogleAuthPayload(BaseModel):
    id_token: str


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=422, detail="Password must contain at least one number")


@app.post("/api/auth/register")
def register(payload: CredentialsPayload):
    if not is_whitelisted(payload.email):
        raise HTTPException(status_code=403, detail="You're not on the beta list")
    _validate_password(payload.password)
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
    token = _create_jwt(user_id, payload.email, username)
    return {"user_id": user_id, "email": payload.email, "username": username, "token": token}


@app.post("/api/auth/password-reset/request")
def password_reset_request(payload: CredentialsPayload):
    from filmprint.email import send_password_reset_email, send_google_account_email
    user = get_user_by_email(payload.email)
    if user:
        if user.get("password_hash"):
            token = secrets.token_urlsafe(32)
            expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
            create_reset_token(user["id"], token, expires_at)
            frontend_url = os.environ.get("FRONTEND_URL", "https://myfilmprint.com")
            reset_url = f"{frontend_url}/reset-password?token={token}"
            send_password_reset_email(payload.email, reset_url)
        else:
            send_google_account_email(payload.email)
    return {"detail": "If an account with that email exists, you'll receive a reset link."}


@app.get("/api/auth/password-reset/validate")
def password_reset_validate(token: str):
    row = get_reset_token(token)
    if not row or row["used"]:
        return {"valid": False, "reason": "invalid"}
    if row["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
        return {"valid": False, "reason": "expired"}
    return {"valid": True}


class ResetPasswordPayload(BaseModel):
    token: str
    password: str


@app.post("/api/auth/password-reset/confirm")
def password_reset_confirm(payload: ResetPasswordPayload):
    _validate_password(payload.password)
    row = get_reset_token(payload.token)
    if not row or row["used"]:
        raise HTTPException(status_code=400, detail="This link has already been used")
    if row["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(status_code=400, detail="This link has expired — request a new one")
    new_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    consume_reset_token(payload.token, new_hash)
    return {"detail": "Password updated"}


@app.post("/api/auth/exchange")
def auth_exchange(payload: ExchangePayload, request: Request):
    """Server-to-server endpoint for NextAuth to exchange a verified email for a backend JWT.
    Gated by INTERNAL_SECRET so it cannot be called by end-user clients.
    """
    if not _INTERNAL_SECRET or request.headers.get("X-Internal-Secret") != _INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    existing = get_user_by_email(payload.email)
    if not existing and not is_whitelisted(payload.email):
        raise HTTPException(status_code=403, detail="You're not on the beta list")
    user_id, username = get_or_create_user_by_email(payload.email)
    token = _create_jwt(user_id, payload.email, username)
    return {"token": token, "user_id": user_id}


@app.post("/api/auth/google")
def google_auth(payload: GoogleAuthPayload):
    r = _requests.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={payload.id_token}")
    if not r.ok:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    claims = r.json()
    if _GOOGLE_CLIENT_ID and claims.get("aud") != _GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Token audience mismatch")
    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google email not verified")
    existing = get_user_by_email(email)
    if not existing and not is_whitelisted(email):
        raise HTTPException(status_code=403, detail="You're not on the beta list")
    user_id, username = get_or_create_user_by_email(email)
    token = _create_jwt(user_id, email, username)
    return {"token": token, "user_id": user_id}


# --- endpoints ---

@app.get("/api/user")
def get_user(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    user_row = get_user_by_id(user_id)
    username = (user_row or {}).get("letterboxd_username") or ""
    ratings_count = get_ratings_count(user_id)
    return {
        "has_profile": ratings_count > 0,
        "needs_username": not username,
        "username": username or None,
        "email": current_user.get("email") or None,
        "ratings_count": ratings_count,
        "watchlist_count": get_watchlist_count(user_id),
        "rebuild_in_progress": _rebuild_jobs.get(user_id) == "running" and user_id not in _user_states,
    }


@app.get("/api/rebuild/status")
def rebuild_status(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    job = _rebuild_jobs.get(user_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No rebuild in progress")
    candidates_count = None
    if job == "done":
        state = _user_states.get(user_id, {})
        candidates_count = len(state.get("ranked") or [])
    return {"status": job, "candidates_count": candidates_count}


def _compute_fp_score(ratings_count: int, genres: list[dict], decades: list[dict]) -> int:
    """0–1000 taste score: depth (log ratings) + diversity (genre + decade entropy).

    Entropy components are scaled by a confidence factor so thin catalogs
    can't earn high diversity scores from noise.
    """
    def _entropy_component(weights: list[float], max_pts: float) -> float:
        weights = [w for w in weights if w > 0]
        if len(weights) < 2:
            return 0.0
        total = sum(weights)
        probs = [w / total for w in weights]
        ent = -sum(p * math.log(p) for p in probs)
        return (ent / math.log(len(weights))) * max_pts

    confidence = ratings_count / (ratings_count + 50)
    depth = min(math.log1p(ratings_count) / math.log1p(2000), 1.0) * 500
    genre_score = _entropy_component([g["weight"] for g in genres], 300) * confidence
    decade_score = _entropy_component([d["weight"] for d in decades], 200) * confidence
    return round(depth + genre_score + decade_score)


def _build_profile_response(user_id: int, state: dict) -> dict:
    """Compute and cache the /api/profile response from an already-built profile state."""
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

    director_counts: dict[str, int] = {}
    for movie in rated_movies:
        raw = movie.get("raw_tmdb") or movie
        crew = (raw.get("credits") or {}).get("crew", [])
        for p in crew:
            if p.get("job") == "Director":
                n = p["name"]
                director_counts[n] = director_counts.get(n, 0) + 1

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

    result = {
        "ratings_count": len(ratings),
        "watchlist_count": len(state.get("watchlist_ids") or []),
        "avg_rating": avg_rating,
        "fp_score": _compute_fp_score(len(ratings), genres, decades),
        "summary": state.get("summary"),
        "ai_summary": state.get("ai_summary"),
        "genres": genres,
        "decades": decades,
        "directors": directors,
        "tone": tone,
        "subgenres": subgenres,
        "critic_alignment": state.get("critic_alignment", 0.0),
        "quality_floor": round(state.get("quality_floor", 6.0) - FLOOR_TOLERANCE, 2),
        "neutral": neutral,
        "favorites": get_five_star_ratings(user_id),
    }
    _profile_response_cache[user_id] = result
    return result


def _build_examples_response(user_id: int, state: dict) -> dict:
    """Compute and cache the /api/profile/examples response from an already-built profile state."""
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
            if not candidates:
                candidates = sorted(
                    [(m, r) for m, r in zip(rated_movies, ratings) if match_fn(name, m)],
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

    result = {"genre": genre_ex, "subgenre": subgenre_ex, "era": era_ex, "tone": tone_ex}
    _examples_response_cache[user_id] = result
    return result


@app.get("/api/profile")
def get_profile(current_user: dict = Depends(get_current_user)):
    """All data needed for the profile page in one call."""
    user_id = current_user["user_id"]
    username = current_user["username"]
    if user_id in _profile_response_cache:
        return _profile_response_cache[user_id]
    state = _get_or_build_profile(user_id, username)
    return _build_profile_response(user_id, state)


@app.get("/api/profile/examples")
def profile_examples(current_user: dict = Depends(get_current_user)):
    """Return top 3 film examples per radar axis, deduplicated within each radar.

    Deduplication ensures each film appears on at most one axis — so hovering
    different points shows different posters rather than the same top-rated films.
    """
    user_id = current_user["user_id"]
    username = current_user["username"]
    if user_id in _examples_response_cache:
        return _examples_response_cache[user_id]
    state = _get_or_build_profile(user_id, username)
    return _build_examples_response(user_id, state)


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
    t0 = time.time()
    state = _get_or_build_state(user_id, username)
    print(f"[rec] user {user_id}: get_or_build_state in {time.time()-t0:.1f}s (cached={user_id in _user_states})", flush=True)

    if not state:
        raise HTTPException(status_code=428, detail="Rate some films to get started")

    # Batch-prime the in-process OMDb score cache so rank_watchlist doesn't make
    # a DB/API call per movie. _restore_state_from_volume does this too, but when
    # state is served from Redis that path is skipped, leaving the cache cold.
    imdb_ids = [(m.get("raw_tmdb") or m).get("imdb_id") for m, _ in state.get("ranked") or []]
    prime_score_cache([iid for iid in imdb_ids if iid])

    session_ids = state.get("session_recommended_ids", set())
    # Merge with DB-backed 24h history so exclusions survive backend restarts/redeploys.
    session_ids = session_ids | get_recent_recommendation_ids(user_id, days=1)
    ranked = [(m, s) for m, s in state["ranked"] if m["id"] not in session_ids]
    keyword_vocab = state["keyword_vocab"]
    affinity = state["affinity"]
    profile_vec = state["profile_vec"]
    watchlist_ids = state["watchlist_ids"]

    user_subgenre_axes = state.get("user_subgenre_axes") or {}
    cluster = _select_cluster(mood, state)
    active_vec = cluster if cluster is not None else profile_vec
    print(f"[rec] user {user_id}: {len(ranked)} candidates, cluster={'yes' if cluster is not None else 'no'}", flush=True)
    if cluster is not None:
        all_candidates = [m for m, _ in ranked]
        t_rw = time.time()
        ranked = rank_watchlist(cluster, all_candidates, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)
        print(f"[rec] user {user_id}: cluster rank_watchlist in {time.time()-t_rw:.1f}s", flush=True)
        active_summary = taste_summary(cluster, keyword_vocab, user_subgenre_axes)
    else:
        active_summary = state["summary"]

    active_vec = _apply_mood_to_vector(active_vec, mood, keyword_vocab, user_subgenre_axes, idf=_idf_weights)
    if mood.tone or mood.pacing or mood.familiarity:
        all_candidates = [m for m, _ in ranked]
        t_rw = time.time()
        ranked = rank_watchlist(active_vec, all_candidates, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)
        print(f"[rec] user {user_id}: mood rank_watchlist in {time.time()-t_rw:.1f}s", flush=True)
    if mood.niche:
        all_candidates = [m for m, _ in ranked]
        t_rw = time.time()
        ranked = rank_watchlist(active_vec, all_candidates, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights, popularity_penalty=0.4)
        print(f"[rec] user {user_id}: niche rank_watchlist in {time.time()-t_rw:.1f}s", flush=True)
    t1 = time.time()

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
            new_ranked = rank_watchlist(active_vec, discovered, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)
            ranked = sorted(ranked + new_ranked, key=lambda x: x[1], reverse=True)
        print(f"[rec] user {user_id}: discover_by_mood ({len(mood.required_genres)} genres) in {time.time()-t1:.1f}s", flush=True)
        t1 = time.time()

    _pool_max = ranked[0][1] if ranked else 1.0
    _pool_min = ranked[-1][1] if ranked else 0.0
    _pool_spread = (_pool_max - _pool_min) or 1.0

    filtered = _apply_filters(ranked, mood)
    diverse = diversify(filtered, ranked, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)

    # Hard-enforce the quality floor using IMDb scores from the DB.
    # Never makes live API calls — only filters if scores are already stored.
    quality_floor = state.get("quality_floor", 6.0)
    from filmprint.db import get_movie_omdb_scores as _get_movie_omdb_scores
    imdb_filtered = []
    for m, s in diverse:
        raw = m.get("raw_tmdb") or m
        imdb_id = raw.get("imdb_id", "")
        if imdb_id:
            scores = _get_movie_omdb_scores(imdb_id)
            if scores:
                imdb_str = scores.get("imdb")
                if imdb_str is not None and float(imdb_str) < quality_floor - FLOOR_TOLERANCE:
                    continue
        imdb_filtered.append((m, s))
    diverse = imdb_filtered or diverse
    print(f"[rec] user {user_id}: rank/filter/diversify in {time.time()-t1:.1f}s ({len(diverse)} candidates)", flush=True)
    t1 = time.time()

    mood_summary = _mood_to_summary(mood)
    picks = _explain_recommendations(diverse, mood_summary, active_summary, watchlist_ids)
    print(f"[rec] user {user_id}: explain in {time.time()-t1:.1f}s", flush=True)

    if picks:
        for p in picks:
            p["match_pct"] = round(65 + ((p["score"] - _pool_min) / _pool_spread) * 34)

    mood_context = {"summary": mood_summary, "filters": mood.model_dump()}
    for pick in picks:
        log_recommendation(user_id, pick["id"], pick["score"], mood_context)
        state["session_recommended_ids"].add(pick["id"])

    print(f"[rec] user {user_id}: total {time.time()-t0:.1f}s", flush=True)
    return {"picks": picks, "mood_summary": mood_summary}


@app.get("/api/picks/director-suggestions")
def get_director_suggestions(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    username = current_user["username"]
    state = _get_or_build_state(user_id, username)
    if not state:
        raise HTTPException(status_code=428, detail="Rate some films to get started")

    suggestions = state.get("director_suggestions") or []
    if not suggestions:
        raise HTTPException(status_code=404, detail="No director suggestions available yet")

    # Rotate through the precomputed list so repeat calls within a session don't
    # always surface the same top entry. Resets once every suggestion has been shown.
    shown = state.setdefault("shown_director_suggestion_ids", set())
    unshown = [s for s in suggestions if s["id"] not in shown]
    if not unshown:
        shown.clear()
        unshown = suggestions

    pick = unshown[0]
    shown.add(pick["id"])
    return {"suggestion": pick}


@app.get("/api/picks/blind-spot-suggestions")
def get_blind_spot_suggestions(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    username = current_user["username"]
    state = _get_or_build_state(user_id, username)
    if not state:
        raise HTTPException(status_code=428, detail="Rate some films to get started")

    suggestions = state.get("blind_spot_suggestions") or []
    if not suggestions:
        raise HTTPException(status_code=404, detail="No blind spot suggestions available yet")

    # Rotate through the precomputed list so repeat calls within a session don't
    # always surface the same top entry. Resets once every suggestion has been shown.
    shown = state.setdefault("shown_blind_spot_suggestion_ids", set())
    unshown = [s for s in suggestions if s["id"] not in shown]
    if not unshown:
        shown.clear()
        unshown = suggestions

    pick = unshown[0]
    shown.add(pick["id"])
    return {"suggestion": pick}


# ── in-app onboarding ────────────────────────────────────────────────────────

# Taste-differentiating, widely-seen films spanning genres, decades, and tones.
# Covers: drama/crime, romance, sci-fi, horror, action/adventure, comedy,
# animation, international prestige, and recent blockbusters.
ONBOARDING_SEED_IDS: list[int] = [
    278,    # The Shawshank Redemption
    238,    # The Godfather
    155,    # The Dark Knight
    680,    # Pulp Fiction
    807,    # Se7en
    597,    # Titanic
    313369, # La La Land
    11036,  # The Notebook
    376867, # Moonlight
    244786, # Whiplash
    62,     # 2001: A Space Odyssey
    603,    # The Matrix
    157336, # Interstellar
    27205,  # Inception
    438631, # Dune
    694,    # The Shining
    493922, # Hereditary
    274,    # The Silence of the Lambs
    496243, # Parasite
    76341,  # Mad Max: Fury Road
    11,     # Star Wars: A New Hope
    120,    # The Lord of the Rings: The Fellowship of the Ring
    329,    # Jurassic Park
    105,    # Back to the Future
    27706,  # Mamma Mia
    218,    # The Truman Show
    13,     # Forrest Gump
    129,    # Spirited Away
    2062,   # Ratatouille
    862,    # Toy Story
    10681,  # WALL-E
    372058, # Your Name
    637,    # Life is Beautiful
    424,    # Schindler's List
    4935,   # Howl's Moving Castle
    299534, # Avengers: Endgame
    569094, # Spider-Man: Across the Spider-Verse
    361743, # Top Gun: Maverick
    510,    # One Flew Over the Cuckoo's Nest
    348,    # Alien
]


@app.get("/api/onboarding/seed-films")
def get_seed_films(current_user: dict = Depends(get_current_user)):
    """Return the curated seed film list for in-app onboarding.

    Films not yet in the catalog are fetched from TMDB and upserted on first call.
    Subsequent calls are fast — TMDB responses are file-cached.
    """
    present = get_movies_by_ids(ONBOARDING_SEED_IDS)
    missing = [mid for mid in ONBOARDING_SEED_IDS if mid not in present]
    for tmdb_id in missing:
        try:
            data = _tmdb_get_movie_details(tmdb_id)
            if data and data.get("id"):
                upsert_movie(data)
                fetched = get_movies_by_ids([tmdb_id])
                if tmdb_id in fetched:
                    present[tmdb_id] = fetched[tmdb_id]
        except Exception as e:
            print(f"[onboarding] failed to seed TMDB {tmdb_id}: {e}", flush=True)

    return [
        {
            "id": m["id"],
            "title": m["title"],
            "year": m.get("year"),
            "poster_path": (m.get("raw_tmdb") or {}).get("poster_path"),
        }
        for mid in ONBOARDING_SEED_IDS
        if (m := present.get(mid))
    ]


class _OnboardingRatingItem(BaseModel):
    movie_id: int
    rating: float


class _OnboardingRatingsPayload(BaseModel):
    ratings: list[_OnboardingRatingItem]


@app.post("/api/onboarding/rate")
def submit_onboarding_ratings(
    payload: _OnboardingRatingsPayload,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Write in-app ratings and kick off a background profile rebuild."""
    user_id = current_user["user_id"]
    username = current_user["username"] or ""

    if not payload.ratings:
        raise HTTPException(status_code=422, detail="No ratings provided")

    for item in payload.ratings:
        upsert_rating(user_id, item.movie_id, item.rating, None, source="in_app")

    if _rebuild_jobs.get(user_id) != "running":
        _rebuild_jobs[user_id] = "running"
        background_tasks.add_task(_run_rebuild_background, user_id, username)

    return {
        "ratings_count": get_ratings_count(user_id),
        "rebuild_status": "pending",
    }


class _ConnectLetterboxdPayload(BaseModel):
    username: str


@app.post("/api/settings/letterboxd")
def connect_letterboxd(
    payload: _ConnectLetterboxdPayload,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Validate and set a Letterboxd username, then kick off a background sync."""
    user_id = current_user["user_id"]
    username = payload.username.strip()

    if not username:
        raise HTTPException(status_code=422, detail="Username is required")

    try:
        exists = validate_username(username)
    except _requests.RequestException:
        raise HTTPException(status_code=503, detail="Could not reach Letterboxd — please try again")
    if not exists:
        raise HTTPException(status_code=422, detail=f"Letterboxd profile '{username}' not found or not public")

    update_user_username(user_id, username)

    if _rebuild_jobs.get(user_id) != "running":
        _rebuild_jobs[user_id] = "running"
        background_tasks.add_task(_run_sync_background, user_id, username)

    return {"rebuild_status": "pending"}


@app.post("/api/sync")
def sync(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Scrape latest ratings and watchlist from Letterboxd in the background."""
    user_id = current_user["user_id"]
    username = current_user["username"]

    if not username:
        raise HTTPException(status_code=428, detail="Set your Letterboxd username before syncing")

    if _rebuild_jobs.get(user_id) == "running":
        return {
            "ratings_count": get_ratings_count(user_id),
            "watchlist_count": get_watchlist_count(user_id),
            "rebuild_status": "pending",
        }

    _rebuild_jobs[user_id] = "running"
    background_tasks.add_task(_run_sync_background, user_id, username)
    return {
        "ratings_count": get_ratings_count(user_id),
        "watchlist_count": get_watchlist_count(user_id),
        "rebuild_status": "pending",
    }


@app.post("/api/import")
async def import_csv(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    file: UploadFile = File(...),
    username: str | None = Form(None),
):
    """Accept a Letterboxd data export (.zip or individual CSV) and ingest it in the background."""
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

    is_zip = bool(file.filename and file.filename.endswith(".zip"))
    content = await file.read()

    # Quick pre-validation before firing background task
    if is_zip:
        try:
            with zipfile.ZipFile(BytesIO(content)) as zf:
                names = zf.namelist()
        except zipfile.BadZipFile:
            raise HTTPException(status_code=422, detail="Upload is not a valid zip file")
        if not any("ratings.csv" in n or "watchlist.csv" in n for n in names):
            raise HTTPException(status_code=422, detail="No ratings.csv or watchlist.csv found in zip")
    else:
        fname = file.filename or ""
        if "ratings" not in fname and "watchlist" not in fname:
            raise HTTPException(status_code=422, detail="File must be ratings.csv or watchlist.csv")

    # Save to persistent temp dir (background task owns cleanup)
    tmp_dir = tempfile.mkdtemp()
    tmp_path = Path(tmp_dir)
    if is_zip:
        with zipfile.ZipFile(BytesIO(content)) as zf:
            zf.extractall(tmp_path)
    else:
        (tmp_path / (file.filename or "ratings.csv")).write_bytes(content)

    if _rebuild_jobs.get(user_id) != "running":
        _rebuild_jobs[user_id] = "running"
        background_tasks.add_task(_run_import_background, user_id, active_username, tmp_dir)
    else:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return {
        "ratings_count": get_ratings_count(user_id),
        "watchlist_count": get_watchlist_count(user_id),
        "candidates_count": None,
        "rebuild_status": "pending",
    }


# --- public user endpoints (no auth required) ---

@app.get("/api/users/search")
def user_search(q: str = ""):
    if not q:
        return {"users": []}
    return {"users": search_users_by_username(q)}


@app.get("/api/users/top")
def get_top_users(limit: int = 20):
    # Pull more candidates than requested so we can sort by taste score after computing
    rows = get_top_users_by_ratings(max(limit * 3, 60))
    result = []
    for row in rows:
        user_id = row["id"]
        username = row["letterboxd_username"] or None
        email = row.get("email") or ""
        display_name = row["display_name"] or (email.split("@")[0] if email else None)
        try:
            profile = _public_profile_response(user_id, username or "")
            top_genres = [g["name"] for g in profile.get("genres", [])[:4]]
            fp_score = profile.get("fp_score", 0)
        except Exception:
            top_genres = []
            fp_score = 0
        if fp_score == 0:
            continue
        result.append({
            "user_id": user_id,
            "username": username,
            "display_name": display_name,
            "fp_score": fp_score,
            "top_genres": top_genres,
        })
    result.sort(key=lambda x: x["fp_score"], reverse=True)
    return {"users": result[:limit]}


def _public_profile_response(user_id: int, username: str) -> dict:
    """Build the same response shape as /api/profile for any user."""
    if user_id in _public_profile_cache:
        return _public_profile_cache[user_id]

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

    decades = [
        {"name": d, "weight": decade_weights.get(d, 0.0)}
        for d in DECADES
        if decade_weights.get(d, 0.0) > 0
    ]
    tone = compute_axis_scores(rated_movies, ratings, TONE_AXES)
    all_subgenres = compute_axis_scores(
        rated_movies, ratings, state.get("user_subgenre_axes") or SUBGENRE_AXES
    )

    result = {
        "letterboxd_username": username,
        "ratings_count": len(ratings),
        "watchlist_count": len(state.get("watchlist_ids") or []),
        "avg_rating": avg_rating,
        "fp_score": _compute_fp_score(len(ratings), genres, decades),
        "summary": state.get("summary"),
        "genres": genres,
        "decades": decades,
        "tone": tone,
        "subgenres": [s for s in all_subgenres if s["weight"] > 0][:8],
        "critic_alignment": state.get("critic_alignment", 0.0),
        "quality_floor": round(state.get("quality_floor", 6.0) - FLOOR_TOLERANCE, 2),
        "neutral": neutral,
        "favorites": get_five_star_ratings(user_id),
    }
    _public_profile_cache[user_id] = result
    return result


@app.get("/api/users/id/{user_id}")
def get_public_profile_by_id(user_id: int):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _public_profile_response(user["id"], user.get("letterboxd_username") or "")


@app.get("/api/users/id/{user_id}/examples")
def get_public_examples_by_id(user_id: int):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _build_public_examples(user_id, user.get("letterboxd_username") or "")


@app.get("/api/users/id/{user_id}/history")
def get_public_history_by_id(user_id: int):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _build_public_history(user_id)


@app.get("/api/users/{username}")
def get_public_profile(username: str):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _public_profile_response(user["id"], username)


def _build_public_examples(user_id: int, username: str) -> dict:
    if user_id in _public_examples_cache:
        return _public_examples_cache[user_id]
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
            if not candidates:
                candidates = sorted(
                    [(m, r) for m, r in zip(rated_movies, ratings) if match_fn(name, m)],
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

    result = {"genre": genre_ex, "subgenre": subgenre_ex, "era": era_ex, "tone": tone_ex}
    _public_examples_cache[user_id] = result
    return result


def _build_public_history(user_id: int) -> dict:
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


@app.get("/api/users/{username}/examples")
def get_public_examples(username: str):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _build_public_examples(user["id"], username)


@app.get("/api/users/{username}/history")
def get_public_history(username: str):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _build_public_history(user["id"])


@app.post("/api/users/{username}/recommendations")
def get_public_recommendations(username: str, mood: MoodContext, request: Request):
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "unknown").split(",")[0].strip()
    if not check_rate_limit(f"ratelimit:demo:{ip}", limit=10, window=60):
        raise HTTPException(status_code=429, detail="Too many requests — try again in a minute")

    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user_id = user["id"]

    state = _get_or_build_state(user_id, username)
    if not state:
        raise HTTPException(status_code=428, detail="No profile for this user")

    imdb_ids = [(m.get("raw_tmdb") or m).get("imdb_id") for m, _ in state.get("ranked") or []]
    prime_score_cache([iid for iid in imdb_ids if iid])

    ranked = list(state["ranked"])
    keyword_vocab = state["keyword_vocab"]
    affinity = state["affinity"]
    profile_vec = state["profile_vec"]
    user_subgenre_axes = state.get("user_subgenre_axes") or {}

    cluster = _select_cluster(mood, state)
    active_vec = cluster if cluster is not None else profile_vec
    if cluster is not None:
        ranked = rank_watchlist(cluster, [m for m, _ in ranked], keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)
        active_summary = taste_summary(cluster, keyword_vocab, user_subgenre_axes)
    else:
        active_summary = state["summary"]

    active_vec = _apply_mood_to_vector(active_vec, mood, keyword_vocab, user_subgenre_axes, idf=_idf_weights)
    if mood.tone or mood.pacing or mood.familiarity:
        ranked = rank_watchlist(active_vec, [m for m, _ in ranked], keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)

    if mood.required_genres:
        existing_ids = {m["id"] for m, _ in ranked}
        excluded = state.get("seen_ids", set()) | existing_ids
        quality_floor = state.get("quality_floor", 6.0)
        discovered_raw = discover_by_mood(mood.required_genres, existing_ids=excluded)
        if discovered_raw:
            discovered_raw = [d for d in discovered_raw if not d.get("vote_average") or d["vote_average"] >= quality_floor]
            for d in discovered_raw:
                upsert_movie(d)
            discovered = ensure_feature_vectors([{**d, "raw_tmdb": d} for d in discovered_raw])
            new_ranked = rank_watchlist(active_vec, discovered, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)
            ranked = sorted(ranked + new_ranked, key=lambda x: x[1], reverse=True)

    _pool_max = ranked[0][1] if ranked else 1.0
    _pool_min = ranked[-1][1] if ranked else 0.0
    _pool_spread = (_pool_max - _pool_min) or 1.0

    filtered = _apply_filters(ranked, mood)
    diverse = diversify(filtered, ranked, keyword_vocab, affinity, user_subgenre_axes, idf=_idf_weights)

    quality_floor = state.get("quality_floor", 6.0)
    from filmprint.db import get_movie_omdb_scores as _get_movie_omdb_scores
    imdb_filtered = []
    for m, s in diverse:
        raw = m.get("raw_tmdb") or m
        imdb_id = raw.get("imdb_id", "")
        if imdb_id:
            scores = _get_movie_omdb_scores(imdb_id)
            if scores:
                imdb = scores.get("imdb_rating")
                if imdb and float(imdb) < quality_floor:
                    continue
        imdb_filtered.append((m, s))

    diverse = imdb_filtered or diverse
    mood_summary = _mood_to_summary(mood)
    picks = _explain_recommendations(diverse, mood_summary, active_summary, state.get("watchlist_ids", set()))
    if picks:
        for p in picks:
            p["match_pct"] = round(65 + ((p["score"] - _pool_min) / _pool_spread) * 34)
    return {"picks": picks, "mood_summary": mood_summary}


# --- admin endpoints ---

@app.get("/api/admin/users")
def admin_list_users(_admin: dict = Depends(get_admin_user)):
    return {"users": get_all_users_with_stats()}


@app.get("/api/admin/themes")
def admin_theme_stats(_admin: dict = Depends(get_admin_user)):
    return get_keyword_theme_stats()


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



@app.post("/api/beta/request")
def submit_beta_request(payload: dict, background_tasks: BackgroundTasks):
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip()
    username = (payload.get("letterboxd_username") or "").strip()
    if not name or not email:
        raise HTTPException(status_code=400, detail="name and email are required")
    if get_user_by_email(email):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    if username and not validate_username(username):
        raise HTTPException(status_code=422, detail="Letterboxd profile not found or not public")
    try:
        request_id = create_beta_request(name, email, username or "")
    except Exception:
        raise HTTPException(status_code=409, detail="A request from this email is already pending")
    if username:
        background_tasks.add_task(_scrape_beta_request, request_id, username)
    return {"status": "received"}


def _scrape_beta_request(request_id: int, username: str) -> None:
    try:
        ratings = scrape_ratings(username)
        watchlist = scrape_watchlist(username)
        update_beta_request_counts(request_id, len(ratings), len(watchlist))
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).error("[beta] scrape failed for request %d: %s", request_id, exc)


@app.get("/api/admin/beta-requests")
def admin_get_beta_requests(_admin: dict = Depends(get_admin_user)):
    return {"requests": get_beta_requests()}


@app.post("/api/admin/beta-requests/{request_id}/approve")
def admin_approve_beta_request(request_id: int, _admin: dict = Depends(get_admin_user)):
    import datetime as _dt
    from filmprint.email import send_approval_email
    req = get_beta_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    approved_until = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=7)
    add_to_whitelist(req["email"], approved_until)
    signup_url = f"{os.environ.get('FRONTEND_URL', 'https://myfilmprint.com')}/signup"
    send_approval_email(req["email"], req["name"], signup_url)
    delete_beta_request(request_id)
    return {"approved": req["email"]}


@app.post("/api/admin/beta-requests/{request_id}/deny")
def admin_deny_beta_request(request_id: int, _admin: dict = Depends(get_admin_user)):
    from filmprint.email import send_denial_email
    req = get_beta_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    send_denial_email(req["email"], req["name"])
    delete_beta_request(request_id)
    return {"denied": req["email"]}


@app.get("/api/admin/whitelist")
def admin_get_whitelist(_admin: dict = Depends(get_admin_user)):
    return {"emails": get_whitelist()}


@app.post("/api/admin/whitelist")
def admin_add_to_whitelist(payload: dict, _admin: dict = Depends(get_admin_user)):
    email = payload.get("email", "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    add_to_whitelist(email)
    return {"added": email}


@app.delete("/api/admin/whitelist/{email}")
def admin_remove_from_whitelist(email: str, _admin: dict = Depends(get_admin_user)):
    remove_from_whitelist(email)
    return {"removed": email}


@app.post("/api/admin/users/{user_id}/rebuild")
def admin_rebuild_user(user_id: int, background_tasks: BackgroundTasks, _admin: dict = Depends(get_admin_user)):
    """Trigger a full state rebuild for a user in the background."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _user_states.pop(user_id, None)
    background_tasks.add_task(_rebuild_state, user_id, user.get("letterboxd_username") or "")
    return {"status": "rebuilding", "user_id": user_id}


@app.post("/api/admin/rebuild-all")
def admin_rebuild_all(_auth: dict = Depends(get_admin_or_internal)):
    """Rebuild full state for all users sequentially, streaming NDJSON progress lines."""
    import json as _json

    def _stream():
        users = get_all_users()
        total = len(users)
        succeeded = 0
        failed = 0
        t_start = time.time()
        for user in users:
            uid = user["id"]
            uname = user.get("letterboxd_username") or ""
            t1 = time.time()
            try:
                _user_states.pop(uid, None)
                _rebuild_state(uid, uname)
                elapsed = round(time.time() - t1, 1)
                succeeded += 1
                yield _json.dumps({"user_id": uid, "username": uname, "status": "done", "elapsed": elapsed}) + "\n"
            except Exception as exc:
                elapsed = round(time.time() - t1, 1)
                failed += 1
                yield _json.dumps({"user_id": uid, "username": uname, "status": "error", "error": str(exc), "elapsed": elapsed}) + "\n"
        yield _json.dumps({
            "status": "complete",
            "total": total,
            "succeeded": succeeded,
            "failed": failed,
            "total_elapsed": round(time.time() - t_start, 1),
        }) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, _admin: dict = Depends(get_admin_user)):
    delete_user(user_id)
    _user_states.pop(user_id, None)
    _user_profile_states.pop(user_id, None)
    _profile_response_cache.pop(user_id, None)
    _examples_response_cache.pop(user_id, None)
    _public_profile_cache.pop(user_id, None)
    _public_examples_cache.pop(user_id, None)
    return {"deleted": user_id}


def _run_build_clusters() -> None:
    import traceback
    try:
        n = build_clusters()
        print(f"[recluster] background task complete — {n} themes", flush=True)
    except Exception as exc:
        print(f"[recluster] background task failed: {exc}", flush=True)
        traceback.print_exc()


@app.post("/api/admin/recluster")
def admin_recluster(background_tasks: BackgroundTasks, _admin: dict = Depends(get_admin_user)):
    """Re-run full co-occurrence + embedding clustering on the catalog."""
    background_tasks.add_task(_run_build_clusters)
    return {"status": "recluster started"}


@app.get("/api/admin/memory")
def admin_memory_profile(_admin: dict = Depends(get_admin_user)):
    """Snapshot current memory usage — Python heap allocations and resident .so sizes."""
    # RSS from /proc
    rss_mb = None
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    rss_mb = round(int(line.split()[1]) / 1024, 1)
                    break
    except OSError:
        pass

    # Per-library RSS from /proc/self/smaps
    so_rss: dict[str, float] = {}
    try:
        current = ""
        with open("/proc/self/smaps") as f:
            for line in f:
                if line and line[0] not in (" ", "\t") and "-" in line.split()[0]:
                    parts = line.split()
                    current = parts[5] if len(parts) >= 6 else ""
                elif line.startswith("Rss:") and current:
                    kb = int(line.split()[1])
                    if kb:
                        so_rss[current] = round(so_rss.get(current, 0) + kb / 1024, 1)
    except OSError:
        pass
    top_libs = sorted(so_rss.items(), key=lambda x: x[1], reverse=True)[:30]

    return {
        "rss_mb": rss_mb,
        "top_libs_mb": [{"path": p, "rss_mb": mb} for p, mb in top_libs if mb > 1],
    }


@app.post("/api/admin/warm-cache")
def warm_cache(_admin: dict = Depends(get_admin_user)):
    """Pre-populate caches from DB data.

    Writes TMDB movie files to the persistent volume and fetches OMDB scores +
    watch providers for any movies that don't have them yet.
    """
    import threading
    from filmprint.tmdb import CACHE_DIR as TMDB_CACHE_DIR
    from filmprint.db import get_all_movies_with_vectors, get_imdb_ids_missing_omdb

    movies = get_all_movies_with_vectors()

    def _run(movies):
        # Write movie_{id}.json directly from DB — no TMDB API calls needed
        TMDB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        for m in movies:
            raw = m.get("raw_tmdb") or {}
            if not raw:
                continue
            cache_file = TMDB_CACHE_DIR / f"movie_{m['id']}.json"
            if not cache_file.exists():
                cache_file.write_text(json.dumps(raw))

        # Fetch OMDB scores only for movies not yet in the DB
        imdb_ids_to_fetch = get_imdb_ids_missing_omdb()
        tmdb_ids = [m["id"] for m in movies]

        with ThreadPoolExecutor(max_workers=5) as pool:
            pool.map(get_scores, imdb_ids_to_fetch)
        with ThreadPoolExecutor(max_workers=5) as pool:
            pool.map(get_watch_providers, tmdb_ids)

    threading.Thread(target=_run, args=(movies,), daemon=True).start()
    return {
        "status": "warming cache in background",
        "movies": len(movies),
        "cache_dir": str(TMDB_CACHE_DIR.resolve()),
    }


@app.get("/health")
def health():
    try:
        from filmprint.db import get_connection as _get_conn
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db unavailable: {e}")


@app.get("/api/admin/cache-stats")
def cache_stats(_admin: dict = Depends(get_admin_user)):
    from filmprint.tmdb import CACHE_DIR as TMDB_CACHE_DIR
    from filmprint.db import get_imdb_ids_missing_omdb
    tmdb_files = list(TMDB_CACHE_DIR.glob("movie_*.json")) if TMDB_CACHE_DIR.exists() else []
    omdb_pending = len(get_imdb_ids_missing_omdb())
    return {
        "cache_dir": str(TMDB_CACHE_DIR.resolve()),
        "movie_files": len(tmdb_files),
        "omdb_pending": omdb_pending,
        "total_size_mb": round(sum(f.stat().st_size for f in tmdb_files) / 1_000_000, 2),
    }


class SupportRequest(BaseModel):
    title: str
    description: str


_GITHUB_SUPPORT_TOKEN = os.getenv("GITHUB_SUPPORT_TOKEN", "")


@app.post("/api/support")
async def file_support_issue(
    body: SupportRequest,
    current_user: dict = Depends(get_current_user),
):
    if not body.title.strip() or not body.description.strip():
        raise HTTPException(status_code=400, detail="Title and description are required")
    if not _GITHUB_SUPPORT_TOKEN:
        raise HTTPException(status_code=503, detail="Support unavailable")

    issue_body = f"**Reported by:** {current_user.get('email', 'unknown')}\n\n{body.description.strip()}"
    res = _requests.post(
        "https://api.github.com/repos/rcaseyx/filmprint/issues",
        headers={
            "Authorization": f"Bearer {_GITHUB_SUPPORT_TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        json={"title": body.title.strip(), "body": issue_body, "labels": ["bug", "beta-feedback"]},
        timeout=10,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Failed to file issue")
    return {"number": res.json()["number"]}
