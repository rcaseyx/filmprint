"""
Download the pre-exported all-MiniLM-L6-v2 ONNX model from HuggingFace and save
the tokenizer alongside it. Both artifacts land in data/ relative to the project root.

Run once locally (or in the Dockerfile) to bake the model into the image so it isn't
fetched at runtime.

Usage: python scripts/export_onnx.py
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

ONNX_PATH = DATA_DIR / "model.onnx"
TOKENIZER_PATH = DATA_DIR / "tokenizer"

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
ONNX_FILENAME = "onnx/model.onnx"


def main() -> None:
    from huggingface_hub import hf_hub_download
    from transformers import AutoTokenizer

    print(f"Downloading {ONNX_FILENAME} from {MODEL_ID} ...")
    tmp_path = hf_hub_download(
        repo_id=MODEL_ID,
        filename=ONNX_FILENAME,
        local_dir=str(DATA_DIR / "_hf_tmp"),
    )

    shutil.move(tmp_path, str(ONNX_PATH))
    shutil.rmtree(DATA_DIR / "_hf_tmp", ignore_errors=True)

    size_mb = ONNX_PATH.stat().st_size / 1_000_000
    print(f"Model saved to {ONNX_PATH} ({size_mb:.1f} MB)")

    print(f"Saving tokenizer to {TOKENIZER_PATH} ...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    tokenizer.save_pretrained(str(TOKENIZER_PATH))

    print("Done.")


if __name__ == "__main__":
    main()
    sys.exit(0)
