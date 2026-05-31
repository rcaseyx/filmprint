# filmprint — Claude working instructions

## Branch and commit workflow

Before writing any code, always:
1. `git checkout main`
2. `git pull origin main`
3. `git checkout -b <descriptive-branch-name>`

Ask before committing. Ask separately before pushing. These are two distinct confirmation gates — **pushing triggers a Railway deploy**.

Never push to a branch whose PR has already been merged.

## Architecture

Two Railway services + two managed services:

- **filmprint-backend** — Python/FastAPI app (`api/main.py` entry point)
- **filmprint-app** — Next.js frontend (`web/`)
- **Postgres** — primary database
- **Redis** — user state cache (48hr TTL per key; falls back to an in-process dict if Redis is unreachable)

Pushes to `main` deploy both services automatically.

## Key files

| File | What it owns |
|------|-------------|
| `api/main.py` | FastAPI app, all API routes, startup pipeline |
| `filmprint/sync.py` | Letterboxd scrape + RSS sync pipeline |
| `filmprint/themes.py` | ONNX encoder (`_OnnxEncoder`), keyword clustering, theme assignment |
| `filmprint/cache.py` | Redis-backed `StateCache` wrapper |
| `filmprint/db.py` | All database queries |
| `filmprint/letterboxd.py` | Letterboxd scraping and RSS parsing |
| `filmprint/features.py` | Feature vector construction |
| `filmprint/profile.py` | Taste profile builder |
| `filmprint/recommender.py` | Cosine similarity ranking |

## ONNX model and tokenizer

`data/model.onnx` and `data/tokenizer/` are **gitignored** and not present locally by default. They're exported during the Docker build via `scripts/export_onnx.py`. Run that script locally if you need them. Don't be surprised when they're missing from the working tree.

## Redis cache behavior

User state (ratings, watchlist, profile vectors, recommendation cache) lives in Redis with a 48hr TTL. On a cache miss, reads return an empty dict — not an error. This means a cold cache can produce misleading state-delta calculations (e.g. the sync endpoint's `ratings_added` count). Be aware of this when reading state before/after mutations.

## Frontend

`web/` uses a version of Next.js with breaking API changes from older versions. Before writing any frontend code, read the local docs at `web/node_modules/next/dist/docs/`. The `web/AGENTS.md` has more detail.

## Running locally

```bash
# Backend
uvicorn api.main:app --reload

# Frontend
cd web && npm run dev

# Tests
pytest tests/
```

## Environment variables

See `.env.example` for required keys: `TMDB_API_KEY`, `ANTHROPIC_API_KEY`, `INTERNAL_SECRET`, `JWT_SECRET`. `REDIS_URL` and `DATABASE_URL` are set by Railway in production.
