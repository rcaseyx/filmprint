# filmprint

Personalized movie recommendations built from your Letterboxd taste profile.

Filmprint ingests your Letterboxd ratings and watchlist, builds a structured taste profile using feature vectors and keyword clustering, and ranks your unseen films against it. Claude then picks tonight's best matches and explains why.

Live at [myfilmprint.com](https://myfilmprint.com).

## How it works

1. **Import** — upload your Letterboxd data export (ZIP or individual CSVs), or sync live via RSS scrape
2. **Enrich** — fetch genres, cast, keywords, runtime, and ratings from TMDB and OMDb
3. **Cluster** — embed all catalog keywords with a local ONNX model (all-MiniLM-L6-v2) and group them into subgenre themes via agglomerative clustering
4. **Profile** — build a weighted feature vector from your rated films encoding genre affinity, decade preference, director affinities, tone axes, and personal subgenres
5. **Rank** — score candidate films (watchlist + discovered) via cosine similarity against your profile
6. **Recommend** — Claude selects the best matches for tonight's mood and writes a short explanation for each pick

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python / FastAPI |
| Frontend | Next.js (App Router) |
| Database | PostgreSQL |
| Cache | Redis (48hr TTL per user) |
| Embeddings | ONNX Runtime (all-MiniLM-L6-v2) |
| AI | Claude (claude-sonnet-4-6) |
| Auth | JWT + Google OAuth via NextAuth |
| Deploy | Railway |

## Running locally

**Backend**
```bash
pip install -r requirements.txt
cp .env.example .env  # fill in keys (see Environment below)
uvicorn api.main:app --reload
```

**Frontend**
```bash
cd web
npm install
npm run dev
```

**Tests**
```bash
pytest tests/
```

The ONNX model and tokenizer (`data/model.onnx`, `data/tokenizer/`) are gitignored. They're exported during the Docker build via `scripts/export_onnx.py` — run that script locally if you need them.

## Environment

| Variable | Description |
|----------|-------------|
| `TMDB_API_KEY` | TMDB API v3 key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `INTERNAL_SECRET` | Shared secret for server-to-server calls (NextAuth → backend) |
| `JWT_SECRET` | Secret for signing user JWTs |
| `DATABASE_URL` | Postgres connection string (set by Railway in production) |
| `REDIS_URL` | Redis connection string (set by Railway in production) |
| `FRONTEND_URL` | Frontend origin, used in password reset emails |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `ADMIN_EMAIL` | Email address with access to admin endpoints |

## Project structure

```
filmprint/
├── api/
│   └── main.py             # FastAPI app — all routes, startup pipeline
├── filmprint/
│   ├── sync.py             # Letterboxd CSV import + RSS/scrape sync
│   ├── themes.py           # ONNX encoder, keyword clustering, theme assignment
│   ├── features.py         # Feature vector construction
│   ├── profile.py          # Taste profile builder
│   ├── recommender.py      # Cosine similarity ranking
│   ├── discovery.py        # TMDB Discover candidate expansion
│   ├── cache.py            # Redis-backed StateCache wrapper
│   ├── db.py               # All database queries
│   ├── letterboxd.py       # Letterboxd scraping and RSS parsing
│   ├── tmdb.py             # TMDB API client
│   ├── omdb.py             # OMDb score fetching and cache
│   └── email.py            # Transactional email (password reset)
├── web/                    # Next.js frontend
│   └── app/
│       ├── picks/          # Recommendation flow
│       ├── profile/        # Taste profile display
│       ├── import/         # Letterboxd data import
│       └── ...
├── scripts/
│   └── export_onnx.py      # Export sentence-transformers model to ONNX
├── tests/
└── .env.example
```
