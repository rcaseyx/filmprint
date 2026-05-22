# filmprint

Personalized movie recommendations built from your Letterboxd taste profile.

Filmprint ingests your Letterboxd ratings and watchlist, enriches each film with TMDB metadata, builds a structured taste profile using feature vectors, and ranks your unwatched films against it. Claude then asks a few mood questions and surfaces tonight's best picks with explanations.

## How it works

1. **Ingest** — parse Letterboxd CSV exports (ratings + watchlist)
2. **Enrich** — fetch genres, cast, keywords, runtime, and scores from TMDB
3. **Vectorize** — encode each film as a structured feature vector (genres, decade, runtime, score, etc.)
4. **Profile** — compute a weighted average of your rated films' vectors = your taste profile
5. **Rank** — score watchlist films via cosine similarity against your profile
6. **Recommend** — Claude asks mood questions, re-ranks, and explains the top picks

## Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Fill in TMDB_API_KEY, ANTHROPIC_API_KEY, LETTERBOXD_USERNAME

# Export your Letterboxd data
# Settings → Export Your Data → place ratings.csv and watchlist.csv in ./data/
```

## Usage

```bash
# Get tonight's recommendations
python main.py

# Refresh ratings from RSS (run periodically)
python scripts/refresh.py
```

## Project structure

```
filmprint/
├── filmprint/
│   ├── letterboxd.py   # CSV + RSS ingestion
│   ├── tmdb.py         # TMDB API client
│   ├── features.py     # feature vector construction
│   ├── profile.py      # taste profile builder
│   ├── recommender.py  # cosine similarity ranking
│   └── cli.py          # mood Q&A and Claude reasoning
├── scripts/
│   └── refresh.py      # periodic RSS data refresh
├── data/               # letterboxd CSV exports (gitignored)
└── main.py             # entry point
```
