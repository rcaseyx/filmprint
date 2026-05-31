"""
Download the all-MiniLM-L6-v2 ONNX model and tokenizer from HuggingFace and
save them to data/. Both artifacts are baked into the Docker image at build
time so they aren't fetched at runtime.

Only requires huggingface_hub — no torch or transformers needed.

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
TOKENIZER_FILES = ["tokenizer.json", "tokenizer_config.json"]


def main() -> None:
    from huggingface_hub import hf_hub_download

    print(f"Downloading {ONNX_FILENAME} from {MODEL_ID} ...")
    tmp_path = hf_hub_download(
        repo_id=MODEL_ID,
        filename=ONNX_FILENAME,
        local_dir=str(DATA_DIR / "_hf_tmp"),
    )
    shutil.move(tmp_path, str(ONNX_PATH))
    shutil.rmtree(DATA_DIR / "_hf_tmp", ignore_errors=True)
    print(f"Model saved to {ONNX_PATH} ({ONNX_PATH.stat().st_size / 1_000_000:.1f} MB)")

    TOKENIZER_PATH.mkdir(parents=True, exist_ok=True)
    for filename in TOKENIZER_FILES:
        print(f"Downloading {filename} from {MODEL_ID} ...")
        tmp_path = hf_hub_download(
            repo_id=MODEL_ID,
            filename=filename,
            local_dir=str(DATA_DIR / "_hf_tmp"),
        )
        shutil.move(tmp_path, str(TOKENIZER_PATH / filename))
    shutil.rmtree(DATA_DIR / "_hf_tmp", ignore_errors=True)
    print(f"Tokenizer saved to {TOKENIZER_PATH}")

    print("Done.")


if __name__ == "__main__":
    main()
    sys.exit(0)
