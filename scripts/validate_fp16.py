"""
Validates that FP16 quantization doesn't degrade embedding quality.
Compares cosine similarity between FP32 and FP16 embeddings on a sample of
movie-adjacent sentences. All similarities should be >= 0.999.

Usage: python scripts/validate_fp16.py
"""

import numpy as np
from sentence_transformers import SentenceTransformer

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

print("Loading FP32 model...")
fp32 = SentenceTransformer("all-MiniLM-L6-v2")
emb_fp32 = fp32.encode(SAMPLES, convert_to_numpy=True, normalize_embeddings=True)

print("Loading FP16 model...")
fp16 = SentenceTransformer("all-MiniLM-L6-v2")
fp16.half()
dtype = next(fp16.parameters()).dtype
print(f"  dtype confirmed: {dtype}")
emb_fp16 = fp16.encode(SAMPLES, convert_to_numpy=True, normalize_embeddings=True)

similarities = [
    float(np.dot(emb_fp32[i], emb_fp16[i]))
    for i in range(len(SAMPLES))
]

print("\nCosine similarities (FP32 vs FP16):")
all_pass = True
for sentence, sim in zip(SAMPLES, similarities):
    status = "PASS" if sim >= 0.999 else "FAIL"
    if status == "FAIL":
        all_pass = False
    print(f"  [{status}] {sim:.6f}  {sentence[:60]}")

print(f"\nMin similarity: {min(similarities):.6f}")
print(f"Result: {'ALL PASS' if all_pass else 'FAILURES DETECTED — do not ship FP16'}")
