"""Filmprint — personalized movie recommendations from your Letterboxd taste profile."""

import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

from filmprint.db import (
    init_db, get_or_prompt_user, get_user_ratings, get_user_watchlist,
    get_seen_movie_ids, get_taste_profile, save_taste_profile,
    is_profile_stale, upsert_movie, update_feature_vector, log_recommendation,
)
from filmprint.sync import sync_ratings_csv, sync_watchlist_csv, sync_watched_csv
from filmprint.features import (
    build_feature_vector, feature_labels,
    build_keyword_vocab, build_affinity_scores,
)
from filmprint.profile import build_taste_profile
from filmprint.recommender import rank_watchlist
from filmprint.discovery import expand_candidates
from filmprint import cli

import numpy as np

DATA_DIR = Path(__file__).parent.parent / "data"


def taste_summary(profile: np.ndarray, keyword_vocab: list[str] | None = None) -> str:
    labels = feature_labels(keyword_vocab)
    top = sorted(zip(labels, profile), key=lambda x: x[1], reverse=True)[:8]
    return ", ".join(f"{label} ({score:.2f})" for label, score in top)


def ensure_feature_vectors(movies: list[dict]) -> list[dict]:
    updated = []
    for m in movies:
        if not m.get("feature_vector"):
            raw = m.get("raw_tmdb") or {}
            vec = build_feature_vector(raw).tolist()
            update_feature_vector(m["id"], vec)
            m["feature_vector"] = vec
        updated.append(m)
    return updated


def main():
    init_db()
    user_id, username = get_or_prompt_user()

    ratings_path = DATA_DIR / "ratings.csv"
    watchlist_path = DATA_DIR / "watchlist.csv"
    watched_path = DATA_DIR / "watched.csv"

    if not ratings_path.exists() or not watchlist_path.exists():
        print("Export your Letterboxd data and place ratings.csv and watchlist.csv in ./data/")
        sys.exit(1)

    print("Syncing Letterboxd data...")
    sync_ratings_csv(user_id, str(ratings_path))
    sync_watchlist_csv(user_id, str(watchlist_path))
    if watched_path.exists():
        sync_watched_csv(user_id, str(watched_path))

    rated_rows = get_user_ratings(user_id)
    rated_movies = ensure_feature_vectors(list(rated_rows))
    ratings = [r["letterboxd_rating"] for r in rated_rows]

    print("Building taste vectors...")
    keyword_vocab = build_keyword_vocab(rated_movies)
    affinity = build_affinity_scores(rated_movies, ratings)

    if is_profile_stale(user_id):
        print("Rebuilding taste profile...")
        profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity)
        save_taste_profile(user_id, profile_vec.tolist(), len(ratings))
    else:
        print("Taste profile up to date.")
        profile_vec = np.array(get_taste_profile(user_id)["vector"])
        # Profile was built with richer dims — rebuild if vector length changed
        expected_len = 32 + len(keyword_vocab) + 2
        if len(profile_vec) != expected_len:
            print("  Vector dimensions changed, rebuilding...")
            profile_vec = build_taste_profile(rated_movies, ratings, keyword_vocab, affinity)
            save_taste_profile(user_id, profile_vec.tolist(), len(ratings))

    summary = taste_summary(profile_vec, keyword_vocab)

    seen_ids = get_seen_movie_ids(user_id)
    watchlist = ensure_feature_vectors(get_user_watchlist(user_id))
    watchlist_ids = {m["id"] for m in watchlist}

    print("Discovering similar films from your top-rated movies...")
    raw_rated = [m.get("raw_tmdb") or m for m in rated_movies]
    discovered_raw = expand_candidates(raw_rated, ratings, seen_ids)
    for d in discovered_raw:
        upsert_movie(d)
    discovered = ensure_feature_vectors([{**d, "raw_tmdb": d} for d in discovered_raw])

    all_candidates = watchlist + [d for d in discovered if d["id"] not in watchlist_ids]
    print(f"  {len(watchlist)} watchlist + {len(discovered)} discovered = {len(all_candidates)} total candidates")

    print("Ranking candidates against your taste profile...")
    ranked = rank_watchlist(profile_vec, all_candidates, keyword_vocab, affinity)

    cli.run(rated_movies, ratings, ranked, summary, watchlist_ids)
