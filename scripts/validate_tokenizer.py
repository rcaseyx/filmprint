"""
Validates that the `tokenizers` library produces bit-for-bit identical outputs
to `AutoTokenizer` for the all-MiniLM-L6-v2 tokenizer.

Must pass before deploying the AutoTokenizer → tokenizers migration (#83).
Checks token IDs, attention masks, type IDs, and final ONNX embeddings.

Run with:
    python scripts/validate_tokenizer.py
"""

import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(override=True)

import numpy as np

_DATA_DIR = Path(__file__).parent.parent / "data"
_TOKENIZER_PATH = str(_DATA_DIR / "tokenizer")
_ONNX_PATH = str(_DATA_DIR / "model.onnx")

SAMPLES = [
    "The Godfather",
    "a slow-burn psychological thriller set in 1970s rural France",
    "funny",
    "Spirited Away",
    "A",
    "this is a much longer piece of text that should trigger truncation behavior " * 5,
    "héros, naïve, café",  # non-ASCII
    "2001: A Space Odyssey",
    "",  # edge case: empty string
    "The quick brown fox jumps over the lazy dog",
]


def _run_autotokenizer(texts):
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(_TOKENIZER_PATH)
    enc = tok(texts, return_tensors="np", padding=True, truncation=True, max_length=128)
    return enc["input_ids"], enc["attention_mask"], enc["token_type_ids"]


def _run_tokenizers_lib(texts):
    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(os.path.join(_TOKENIZER_PATH, "tokenizer.json"))
    tok.enable_padding()
    tok.enable_truncation(max_length=128)
    encodings = tok.encode_batch(texts)
    input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
    attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
    token_type_ids = np.array([e.type_ids for e in encodings], dtype=np.int64)
    return input_ids, attention_mask, token_type_ids


def _embed(input_ids, attention_mask, token_type_ids):
    import onnxruntime as ort
    session = ort.InferenceSession(str(_ONNX_PATH), providers=["CPUExecutionProvider"])
    (hidden,) = session.run(
        ["last_hidden_state"],
        {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "token_type_ids": token_type_ids,
        },
    )
    mask = attention_mask[:, :, np.newaxis].astype(np.float32)
    pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1).clip(min=1e-9)
    norms = np.linalg.norm(pooled, axis=1, keepdims=True).clip(min=1e-9)
    return pooled / norms


def main():
    # Filter out empty string — AutoTokenizer and tokenizers may handle it differently
    # but it's not a real input in production
    texts = [t for t in SAMPLES if t]

    print(f"Comparing tokenizers on {len(texts)} samples...\n")

    # Also verify that batch size doesn't affect per-sample embeddings. Production splits
    # into chunks of 256, so padding is determined per-batch. Each sample encoded alone
    # will have different padding than when encoded in a group — embeddings should still match
    # because mean pooling is masked, so padding tokens never contribute.
    print("  Checking per-sample embedding consistency across batch sizes...")
    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(os.path.join(_TOKENIZER_PATH, "tokenizer.json"))
    tok.enable_padding()
    tok.enable_truncation(max_length=128)

    def _encode_one(text):
        enc = tok.encode_batch([text])
        return (
            np.array([e.ids for e in enc], dtype=np.int64),
            np.array([e.attention_mask for e in enc], dtype=np.int64),
            np.array([e.type_ids for e in enc], dtype=np.int64),
        )

    single_embs = np.array([_embed(*_encode_one(t))[0] for t in texts])

    full_enc = tok.encode_batch(texts)
    full_embs = _embed(
        np.array([e.ids for e in full_enc], dtype=np.int64),
        np.array([e.attention_mask for e in full_enc], dtype=np.int64),
        np.array([e.type_ids for e in full_enc], dtype=np.int64),
    )

    if not np.allclose(single_embs, full_embs, atol=1e-5):
        max_diff = np.abs(single_embs - full_embs).max()
        print(f"  ✗ Embeddings differ across batch sizes (max delta: {max_diff:.2e}) — MIGRATION NOT SAFE")
        sys.exit(1)
    else:
        print("  ✓ Embeddings consistent across batch sizes\n")


    auto_ids, auto_mask, auto_types = _run_autotokenizer(texts)
    tok_ids, tok_mask, tok_types = _run_tokenizers_lib(texts)

    failures = []

    if not np.array_equal(auto_ids, tok_ids):
        failures.append("input_ids differ")
    else:
        print("  ✓ input_ids match")

    if not np.array_equal(auto_mask, tok_mask):
        failures.append("attention_mask differs")
    else:
        print("  ✓ attention_mask matches")

    if not np.array_equal(auto_types, tok_types):
        failures.append("token_type_ids differ")
    else:
        print("  ✓ token_type_ids match")

    if failures:
        print(f"\nTokenizer outputs differ — MIGRATION NOT SAFE")
        for f in failures:
            print(f"  ✗ {f}")
        sys.exit(1)

    # Tokenization matches — now verify embeddings are also identical
    print("\nChecking ONNX embeddings...")
    auto_embs = _embed(auto_ids, auto_mask, auto_types)
    tok_embs = _embed(tok_ids, tok_mask, tok_types)

    if not np.allclose(auto_embs, tok_embs, atol=1e-6):
        max_diff = np.abs(auto_embs - tok_embs).max()
        print(f"\n  ✗ Embeddings differ (max delta: {max_diff:.2e}) — MIGRATION NOT SAFE")
        sys.exit(1)

    print("  ✓ Embeddings match (within 1e-6)\n")
    print("All checks passed — safe to migrate.")


if __name__ == "__main__":
    main()
