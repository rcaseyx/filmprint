"""
Validates that the ONNX model produces embeddings equivalent to the PyTorch baseline.
All cosine similarities should be >= 0.999.

Run after export_onnx.py and before committing.

Usage: python scripts/validate_onnx.py
"""

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

SAMPLES = [
    "A visually stunning science fiction epic about space exploration",
    "A romantic comedy set in New York City",
    "A dark psychological thriller with an unreliable narrator",
    "An animated family film about friendship and adventure",
    "A gritty crime drama set in 1970s Los Angeles",
    "A historical war film based on true events",
    "A slow-burn horror movie with atmospheric dread",
    "A French New Wave film with non-linear storytelling",
    "A superhero blockbuster with spectacular action sequences",
    "A quiet indie drama about grief and loss",
]


def main() -> None:
    print("Loading PyTorch baseline...")
    from sentence_transformers import SentenceTransformer
    pt_model = SentenceTransformer("all-MiniLM-L6-v2")
    emb_pt = pt_model.encode(SAMPLES, convert_to_numpy=True, normalize_embeddings=True)

    print("Loading ONNX model via filmprint encoder...")
    from filmprint.themes import _get_model
    onnx_model = _get_model()
    emb_onnx = onnx_model.encode(SAMPLES)

    # Normalize ONNX output for fair comparison (encoder already normalizes, but be explicit)
    norms = np.linalg.norm(emb_onnx, axis=1, keepdims=True).clip(min=1e-9)
    emb_onnx = emb_onnx / norms

    similarities = [float(np.dot(emb_pt[i], emb_onnx[i])) for i in range(len(SAMPLES))]

    print("\nCosine similarities (PyTorch vs ONNX):")
    all_pass = True
    for sentence, sim in zip(SAMPLES, similarities):
        status = "PASS" if sim >= 0.999 else "FAIL"
        if status == "FAIL":
            all_pass = False
        print(f"  [{status}] {sim:.6f}  {sentence[:60]}")

    print(f"\nMin similarity: {min(similarities):.6f}")
    print(f"Result: {'ALL PASS' if all_pass else 'FAILURES DETECTED — do not ship'}")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
