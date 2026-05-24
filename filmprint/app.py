from filmprint.db import update_feature_vector
from filmprint.features import build_feature_vector


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
