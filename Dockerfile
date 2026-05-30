FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# CPU-only PyTorch — prevents pip from pulling the 2GB CUDA build
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

COPY filmprint/ ./filmprint/
COPY api/ ./api/
COPY scripts/ ./scripts/
COPY pyproject.toml .

RUN pip install --no-cache-dir -e . --no-deps

# Download the pre-exported ONNX model and tokenizer so PyTorch is never
# imported at runtime — reduces memory by ~200-300 MB.
RUN python scripts/export_onnx.py

EXPOSE 8000


CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}
