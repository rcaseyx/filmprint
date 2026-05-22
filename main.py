"""Filmprint — personalized movie recommendations from your Letterboxd taste profile."""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from filmprint.letterboxd import load_ratings_csv, load_watchlist_csv
from filmprint.tmdb import enrich_movie
from filmprint.features import build_feature_vector, feature_labels
from filmprint.profile import build_taste_profile
from filmprint.recommender import rank_watchlist
from filmprint import cli

import numpy as np

DATA_DIR = Path(__file__).parent / "data"


def load_and_enrich(csv_loader, path: Path) -> tuple[list[dict], list]:
    df = csv_loader(str(path))
    movies, meta = [], []
    for _, row in df.iterrows():
        enriched = enrich_movie(row["title"], row.get("year"))
        if enriched:
            movies.append(enriched)
            meta.append(row)
    return movies, meta


def taste_summary(profile: np.ndarray) -> str:
    labels = feature_labels()
    top = sorted(zip(labels, profile), key=lambda x: x[1], reverse=True)[:8]
    return ", ".join(f"{label} ({score:.2f})" for label, score in top)


def main():
    ratings_path = DATA_DIR / "ratings.csv"
    watchlist_path = DATA_DIR / "watchlist.csv"

    if not ratings_path.exists() or not watchlist_path.exists():
        print("Export your Letterboxd data and place ratings.csv and watchlist.csv in ./data/")
        sys.exit(1)

    print("Loading rated films...")
    rated_movies, rated_meta = load_and_enrich(load_ratings_csv, ratings_path)
    ratings = [row["rating"] for row in rated_meta]

    print("Building taste profile...")
    profile = build_taste_profile(rated_movies, ratings)
    summary = taste_summary(profile)

    print("Loading watchlist...")
    watchlist_movies, _ = load_and_enrich(load_watchlist_csv, watchlist_path)

    print("Ranking watchlist against your taste profile...")
    ranked = rank_watchlist(profile, watchlist_movies)

    cli.run(rated_movies, ratings, watchlist_movies, ranked, summary)


if __name__ == "__main__":
    main()
