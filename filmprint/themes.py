"""Keyword-to-subgenre theme discovery using co-occurrence + sentence embeddings.

Clustering pipeline (build_clusters):
  1. Build a keyword × film term-document matrix from the movies table
  2. Co-occurrence similarity: normalize rows → dot product gives cosine sim
     between keyword co-appearance patterns across the catalog
  3. Embedding similarity: all-MiniLM-L6-v2 for semantic signal
  4. Combined similarity (60% co-occurrence, 40% embedding), converted to distance
  5. Agglomerative clustering with a distance threshold (data-driven n_clusters)
  6. Label each cluster from its most central keyword, preferring seed theme names
  7. Write to keyword_themes (never overwrite source=seed or source=claude)
  8. Store centroid vectors in theme_centroids table for fast subsequent startups
  9. Assign below-threshold keywords to nearest stored centroid

Startup (backfill_catalog_keywords):
  - Load centroids from DB into memory — no re-embedding
  - If no centroids exist yet, run build_clusters() first
  - Assign any catalog keywords not yet in keyword_themes to nearest centroid

source column: 'seed' = hand-curated  |  'auto' = cluster/embed-assigned
               'claude' = corrected by periodic Claude cleanup pass
"""

import json
from collections import Counter, defaultdict

import numpy as np

from .db import (
    get_all_keyword_themes, get_all_keyword_themes_full, get_connection,
    load_theme_centroids, save_theme_centroids, upsert_keyword_theme,
)

# ── tunables ────────────────────────────────────────────────────────────────

MIN_FILM_COUNT = 3      # keywords in fewer films are sparse-assigned, not clustered
CO_WEIGHT = 0.6         # co-occurrence vs embedding weight in combined similarity
CLUSTER_DISTANCE = 0.55 # agglomerative linkage cutoff (distance = 1 − similarity)
ASSIGN_THRESHOLD = 0.35 # min cosine to nearest centroid to join it vs own theme

_NOISE_KEYWORDS: frozenset[str] = frozenset({
    # TMDB metadata tags
    "aftercreditsstinger", "duringcreditsstinger",
    "based on novel or book", "based on novel", "based on comic",
    "based on true story", "based on short film",
    "sequel", "prequel", "spin-off", "reboot", "remake",
    "female protagonist", "male protagonist",
    "independent film", "cult film",
    # Character roles — archetypes, not subgenres
    "villain", "supervillain", "anti villain", "master villain", "mystery villain",
    "evil villain", "masked supervillain",
    "hero", "child hero", "returning hero",
    "protagonist", "antagonist", "anti-hero", "antihero", "sidekick",
    "tyrant", "control freak",
    # Major cities/locations — belong in a location axis, not subgenre
    "new york city", "new york", "los angeles", "london", "paris", "tokyo",
    "berlin", "rome", "moscow", "chicago", "san francisco", "miami",
    "las vegas", "washington d.c.", "washington dc", "boston", "seattle",
    "philadelphia", "detroit", "atlanta", "hong kong", "sydney", "toronto",
    "madrid", "barcelona", "amsterdam", "vienna", "budapest", "prague",
    "shanghai", "beijing", "mumbai", "dubai",
    # US states as standalone keywords
    "california", "new york state", "texas", "florida", "illinois",
})

# Themes excluded from the subgenre radar — character archetypes and standalone
# city-name clusters that slipped through before keyword-level filtering caught them.
# Theme names with a comma are city+country/state TMDB clusters ("Berlin, Germany").
_NOISE_THEMES: frozenset[str] = frozenset({
    "Villain", "Hero", "Protagonist", "Antagonist",
    "New York City", "New York State", "Manhattan, New York City",
    "London, England",
})

# ── module-level cache ───────────────────────────────────────────────────────

_model = None
_centroids: dict[str, np.ndarray] = {}   # theme → mean embedding vector


def _get_model():
    global _model
    if _model is None:
        import logging
        logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


# ── centroid helpers ─────────────────────────────────────────────────────────

def _load_centroids_from_db() -> None:
    """Populate the in-memory centroid cache from the theme_centroids table."""
    global _centroids
    stored = load_theme_centroids()
    _centroids = {theme: np.array(vec, dtype=np.float32) for theme, vec in stored.items()}


def _store_centroids(centroids: dict[str, np.ndarray]) -> None:
    global _centroids
    _centroids = centroids
    save_theme_centroids({t: v.tolist() for t, v in centroids.items()})


def _compute_centroids_from_table() -> dict[str, np.ndarray]:
    """Embed all keywords grouped by theme, return mean vector per theme."""
    theme_map = get_all_keyword_themes()
    theme_keywords: dict[str, list[str]] = defaultdict(list)
    for kw, theme in theme_map.items():
        theme_keywords[theme].append(kw)

    model = _get_model()
    result: dict[str, np.ndarray] = {}
    all_themes = list(theme_keywords.keys())
    all_kws = [theme_keywords[t] for t in all_themes]

    for theme, kws in zip(all_themes, all_kws):
        embs = model.encode(kws, show_progress_bar=False, batch_size=256)
        result[theme] = embs.mean(axis=0)
    return result


# ── catalog keyword extraction ───────────────────────────────────────────────

def _get_catalog_keyword_films() -> dict[str, set[int]]:
    """Return {keyword: set_of_film_ids} for all non-noise keywords in movies."""
    kw_films: dict[str, set[int]] = defaultdict(set)
    with get_connection() as conn:
        for row in conn.execute(
            "SELECT id, keywords FROM movies WHERE keywords IS NOT NULL"
        ).fetchall():
            try:
                kw_data = json.loads(row["keywords"])
                if isinstance(kw_data, dict):
                    kw_data = kw_data.get("keywords", [])
                seen: set[str] = set()
                for k in kw_data:
                    name = k["name"] if isinstance(k, dict) else k
                    if name and name.lower() not in _NOISE_KEYWORDS and name not in seen:
                        kw_films[name].add(row["id"])
                        seen.add(name)
            except Exception:
                pass
    return kw_films


# ── full clustering ──────────────────────────────────────────────────────────

def build_clusters() -> int:
    """Cluster catalog keywords via co-occurrence + embeddings, write to DB.

    Only processes keywords with >= MIN_FILM_COUNT appearances (enough signal
    for co-occurrence). Keywords below that threshold are sparse-assigned to the
    nearest centroid afterward.

    Never overwrites source='seed' or source='claude' entries.
    Returns the number of distinct themes after clustering.
    """
    from sklearn.preprocessing import normalize
    from sklearn.cluster import AgglomerativeClustering

    kw_films = _get_catalog_keyword_films()

    qualified = {kw: films for kw, films in kw_films.items() if len(films) >= MIN_FILM_COUNT}
    sparse_kws = [kw for kw, films in kw_films.items() if len(films) < MIN_FILM_COUNT]

    if len(qualified) < 2:
        return 0

    keywords = list(qualified.keys())
    n_kw = len(keywords)
    kw_index = {kw: i for i, kw in enumerate(keywords)}

    all_film_ids = sorted({fid for films in qualified.values() for fid in films})
    film_index = {fid: i for i, fid in enumerate(all_film_ids)}

    # ── term-document matrix (keywords × films) ──────────────────────────────
    from scipy.sparse import lil_matrix
    td = lil_matrix((n_kw, len(all_film_ids)), dtype=np.float32)
    for kw, films in qualified.items():
        row = kw_index[kw]
        for fid in films:
            td[row, film_index[fid]] = 1.0
    td = td.tocsr()

    # Co-occurrence similarity: normalized rows → cosine similarity matrix
    td_norm = normalize(td, norm="l2")
    cooc_sim = np.asarray((td_norm @ td_norm.T).todense(), dtype=np.float32)

    # ── embedding similarity ─────────────────────────────────────────────────
    model = _get_model()
    embs = model.encode(keywords, show_progress_bar=False, batch_size=256)
    embs_norm = embs / (np.linalg.norm(embs, axis=1, keepdims=True) + 1e-8)
    emb_sim = (embs_norm @ embs_norm.T).astype(np.float32)

    # ── combined distance matrix ─────────────────────────────────────────────
    combined = CO_WEIGHT * cooc_sim + (1.0 - CO_WEIGHT) * emb_sim
    np.fill_diagonal(combined, 1.0)
    distance = np.clip(1.0 - combined, 0.0, 2.0).astype(np.float64)

    # ── agglomerative clustering ─────────────────────────────────────────────
    clustering = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=CLUSTER_DISTANCE,
    )
    labels = clustering.fit_predict(distance)

    # ── label each cluster ───────────────────────────────────────────────────
    clusters: dict[int, list[int]] = defaultdict(list)
    for i, label in enumerate(labels):
        clusters[label].append(i)

    existing_full = {r["keyword"]: r for r in get_all_keyword_themes_full()}

    theme_assignments: dict[str, str] = {}   # keyword → theme name
    cluster_centroids: dict[str, np.ndarray] = {}  # theme name → centroid embedding

    for label, indices in clusters.items():
        # Prefer seed theme name if any cluster member is seeded
        seed_themes = [
            existing_full[keywords[i]]["theme"]
            for i in indices
            if keywords[i] in existing_full and existing_full[keywords[i]]["source"] == "seed"
        ]
        if seed_themes:
            theme_name = Counter(seed_themes).most_common(1)[0][0]
        elif len(indices) == 1:
            theme_name = keywords[indices[0]].title()
        else:
            # Most central = highest average similarity to other cluster members
            sub_sim = combined[np.ix_(indices, indices)]
            center_local = int(np.argmax(sub_sim.sum(axis=1)))
            theme_name = keywords[indices[center_local]].title()

        for i in indices:
            theme_assignments[keywords[i]] = theme_name

        cluster_centroids[theme_name] = embs[indices].mean(axis=0)

    # ── write to DB (preserve seed + claude) ────────────────────────────────
    for kw, theme in theme_assignments.items():
        src = existing_full.get(kw, {}).get("source")
        if src in ("seed", "claude"):
            continue
        upsert_keyword_theme(kw, theme, source="auto")

    # ── store centroids, then assign sparse keywords ─────────────────────────
    _store_centroids(cluster_centroids)
    assign_new_keywords(sparse_kws)

    return len(cluster_centroids)


# ── incremental assignment ───────────────────────────────────────────────────

def assign_new_keywords(keywords: list[str]) -> None:
    """Assign keywords not yet in keyword_themes to the nearest cluster centroid.

    Uses the in-memory centroid cache built by build_clusters() or loaded from
    the theme_centroids DB table. Falls back to a standalone theme when no
    centroid scores above ASSIGN_THRESHOLD.
    """
    if not keywords:
        return

    existing = get_all_keyword_themes()
    new_kws = [
        kw for kw in keywords
        if kw not in existing and kw.lower() not in _NOISE_KEYWORDS
    ]
    if not new_kws:
        return

    model = _get_model()
    kw_embs = model.encode(new_kws, show_progress_bar=False, batch_size=256)
    kw_norm = kw_embs / (np.linalg.norm(kw_embs, axis=1, keepdims=True) + 1e-8)

    if _centroids:
        theme_names = list(_centroids.keys())
        centroid_matrix = np.stack([_centroids[t] for t in theme_names])
        c_norm = centroid_matrix / (np.linalg.norm(centroid_matrix, axis=1, keepdims=True) + 1e-8)
        sims = kw_norm @ c_norm.T  # (n_new, n_themes)

        for kw, sim_row in zip(new_kws, sims):
            best_idx = int(np.argmax(sim_row))
            if sim_row[best_idx] >= ASSIGN_THRESHOLD:
                upsert_keyword_theme(kw, theme_names[best_idx], source="auto")
            # else: leave unmapped — sparse keywords that don't fit a cluster
            # stay out of the table rather than cluttering it as singletons
    # If no centroids exist yet, skip — build_clusters() will assign everything


# ── startup backfill ─────────────────────────────────────────────────────────

def backfill_catalog_keywords() -> int:
    """Called at API startup. Fast path after first run.

    First run (no centroids in DB): runs build_clusters() — ~10–15s.
    Subsequent runs: loads centroids from DB, assigns only new keywords — ~1s.

    Returns number of distinct themes.
    """
    _load_centroids_from_db()

    if not _centroids:
        # First run — build clusters from scratch
        n = build_clusters()
        return n

    # Fast path: assign any catalog keywords not yet in keyword_themes
    kw_films = _get_catalog_keyword_films()
    existing = get_all_keyword_themes()
    new_kws = [kw for kw in kw_films if kw not in existing]
    assign_new_keywords(new_kws)

    return len({v for v in get_all_keyword_themes().values()})


# ── claude cleanup ───────────────────────────────────────────────────────────

def claude_cleanup_themes() -> list[dict]:
    """Send multi-keyword themes to Claude Haiku for label correction and merging.

    Asks Claude to return a {old_label: new_label} map. Themes that should merge
    all map to the same new label. Only themes needing changes are returned.
    Corrections are written with source='claude' so future recluster runs can
    identify what's already been reviewed.

    Centroids are updated in-memory by renaming/averaging — no re-embedding needed.

    Returns a list of changes: [{from, to, keywords}]
    """
    import anthropic

    theme_map = get_all_keyword_themes()
    theme_keywords: dict[str, list[str]] = defaultdict(list)
    for kw, theme in theme_map.items():
        theme_keywords[theme].append(kw)

    multi = {t: kws for t, kws in theme_keywords.items() if len(kws) > 1}
    if not multi:
        return []

    theme_list = "\n".join(
        f'"{theme}" ({len(kws)} kws): {", ".join(kws[:8])}{"…" if len(kws) > 8 else ""}'
        for theme, kws in sorted(multi.items(), key=lambda x: -len(x[1]))
    )

    prompt = f"""You are reviewing auto-generated subgenre theme labels for a film recommendation system.
Each theme is a cluster of TMDB keywords grouped by co-occurrence across the film catalog.
The label is the most "central" keyword in each cluster — not always the best human-readable name.

Themes to review (each line: label, keyword count, up to 8 sample keywords):
{theme_list}

Your job — fix only clear problems:
1. Rename labels that are obviously wrong or confusing (e.g. "Primate" → "Wildlife Horror")
2. Merge themes that are genuinely duplicates or near-identical in meaning (e.g. "Satanism" + "Satanic Ritual" → "Satanic Horror")
3. Leave everything else alone — when in doubt, do NOT change it

Be conservative. Do NOT:
- Merge themes that are related but meaningfully distinct (e.g. keep "Super Power" and "Superhero" separate)
- Rename a label to something more generic just because it could be broader
- Change labels that are already clear and accurate

Label rules:
- 1–4 words, title-cased
- Describes a film subgenre, setting, or recurring theme

Return ONLY a valid JSON object. Keys are current labels, values are corrected labels.
Only include themes that genuinely need changes. No explanation, no markdown, just JSON.

Example: {{"Primate": "Wildlife Horror", "Satanism": "Satanic Horror", "Satanic Ritual": "Satanic Horror"}}"""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    reply = response.content[0].text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    corrections: dict[str, str] = json.loads(reply)

    if not corrections:
        return []

    # Apply to DB
    changes: list[dict] = []
    with get_connection() as conn:
        for old_theme, new_theme in corrections.items():
            if old_theme == new_theme:
                continue
            row = conn.execute(
                "SELECT COUNT(*) as n FROM keyword_themes WHERE theme = ?", (old_theme,)
            ).fetchone()
            if not row or row["n"] == 0:
                continue
            conn.execute(
                "UPDATE keyword_themes SET theme = ?, source = 'claude' WHERE theme = ?",
                (new_theme, old_theme),
            )
            changes.append({"from": old_theme, "to": new_theme, "keywords": row["n"]})

    # Update centroids in-memory and in DB by renaming/averaging — no re-embedding
    if changes and _centroids:
        updated = dict(_centroids)
        for change in changes:
            old, new = change["from"], change["to"]
            if old not in updated:
                continue
            if new in updated:
                # Merge: average the two centroids
                updated[new] = (updated[new] + updated[old]) / 2.0
            else:
                updated[new] = updated[old]
            del updated[old]
        _store_centroids(updated)

    return changes


# ── user subgenre axes ───────────────────────────────────────────────────────

def _is_noise_theme(theme: str) -> bool:
    """True for themes that are locations or character archetypes, not subgenres."""
    if theme in _NOISE_THEMES:
        return True
    # City, Country / City, State format from TMDB keyword clusters
    if "," in theme:
        return True
    return False


def build_user_subgenre_axes(keyword_vocab: list[str]) -> dict[str, list[str]]:
    """Map a user's keyword vocab through the shared lookup table.

    Returns {theme_name: [keywords_in_that_theme_present_in_vocab]}.
    Only themes with at least one matching keyword are included.
    """
    theme_map = get_all_keyword_themes()
    axes: dict[str, list[str]] = defaultdict(list)
    for kw in keyword_vocab:
        if kw.lower() in _NOISE_KEYWORDS:
            continue
        theme = theme_map.get(kw)
        if theme and not _is_noise_theme(theme):
            axes[theme].append(kw)
    return dict(axes)
