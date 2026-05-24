"""Keyword-to-subgenre theme assignment using sentence embeddings.

Assignment strategy: embed each new keyword and compare it to the embedding of
every known theme NAME (not keyword centroids). Theme names are concise and
semantically clean — comparing "film noir" to "Neo-noir" scores 0.80+, while
comparing "pixar" to any existing noir/thriller theme scores <0.45, so it
correctly seeds a new "Pixar" theme rather than being shoehorned into the
wrong bucket.

As the theme table grows organically (auto + claude corrections), new theme
names become part of the comparison pool, improving assignment quality over time.

source column: 'seed' = hand-curated, 'auto' = embedding-assigned,
               'claude' = corrected by periodic Claude cleanup pass.
"""

from collections import defaultdict

import numpy as np

from .db import get_all_keyword_themes, upsert_keyword_theme

SIMILARITY_THRESHOLD = 0.65
_MODEL_NAME = "all-MiniLM-L6-v2"

# TMDB metadata tags that aren't meaningful subgenre signals
_NOISE_KEYWORDS: frozenset[str] = frozenset({
    "aftercreditsstinger", "duringcreditsstinger",
    "based on novel or book", "based on novel", "based on comic",
    "based on true story", "based on short film",
    "sequel", "prequel", "spin-off", "reboot", "remake",
    "female protagonist", "male protagonist",
    "independent film", "cult film",
})

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def assign_new_keywords(keywords: list[str]) -> None:
    """Embed new keywords and assign each to the most similar theme name.

    If no theme name scores above SIMILARITY_THRESHOLD the keyword seeds a
    new theme named after itself (title-cased). Comparison targets include all
    currently known theme names so auto-created themes (like "Animation") become
    valid targets for future imports.
    """
    if not keywords:
        return

    existing = get_all_keyword_themes()
    new_kws = [kw for kw in keywords if kw not in existing and kw.lower() not in _NOISE_KEYWORDS]
    if not new_kws:
        return

    model = _get_model()

    # Embed all distinct theme names currently in the table
    theme_names = list({t for t in existing.values()})
    if theme_names:
        theme_name_embs = dict(zip(theme_names, model.encode(theme_names, show_progress_bar=False)))
    else:
        theme_name_embs = {}

    kw_embeddings = model.encode(new_kws, show_progress_bar=False)

    for kw, emb in zip(new_kws, kw_embeddings):
        if theme_name_embs:
            best_theme = max(theme_name_embs, key=lambda t: _cosine(emb, theme_name_embs[t]))
            score = _cosine(emb, theme_name_embs[best_theme])
            theme = best_theme if score >= SIMILARITY_THRESHOLD else kw.title()
        else:
            theme = kw.title()

        upsert_keyword_theme(kw, theme, source="auto")


def backfill_catalog_keywords() -> int:
    """Assign any keywords present in the movies table that aren't yet in keyword_themes.

    Safe to call repeatedly — only processes genuinely new keywords each time.
    Returns the number of keywords newly assigned.
    """
    import json
    from .db import get_connection

    existing = get_all_keyword_themes()

    all_kws: set[str] = set()
    with get_connection() as conn:
        for row in conn.execute("SELECT keywords FROM movies WHERE keywords IS NOT NULL").fetchall():
            try:
                kw_data = json.loads(row["keywords"])
                if isinstance(kw_data, dict):
                    kw_data = kw_data.get("keywords", [])
                for k in kw_data:
                    name = k["name"] if isinstance(k, dict) else k
                    if name:
                        all_kws.add(name)
            except Exception:
                pass

    new_kws = [kw for kw in all_kws if kw not in existing]
    if not new_kws:
        return 0

    assign_new_keywords(new_kws)
    return len(new_kws)


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
        if theme:
            axes[theme].append(kw)
    return dict(axes)
