import time as _time

from filmprint.db import update_feature_vector, batch_update_feature_vectors
from filmprint.features import build_feature_vector


def ensure_feature_vectors(movies: list[dict], label: str = "vectorize") -> list[dict]:
    t0 = _time.time()
    to_update: list[tuple[int, list[float]]] = []
    result = []
    for m in movies:
        if not m.get("feature_vector"):
            try:
                raw = m.get("raw_tmdb") or {}
                vec = build_feature_vector(raw).tolist()
                m = {**m, "feature_vector": vec}
                to_update.append((m["id"], vec))
            except Exception:
                pass
        result.append(m)
    if to_update:
        batch_update_feature_vectors(to_update)
    print(f"[{label}] {len(to_update)} vectors computed+saved, {len(movies)-len(to_update)} cached — {_time.time()-t0:.1f}s", flush=True)
    return result
