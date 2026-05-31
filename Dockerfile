FROM python:3.12-slim AS builder

WORKDIR /app

# Only huggingface_hub needed to download model and tokenizer artifacts
RUN pip install --no-cache-dir huggingface_hub

COPY scripts/export_onnx.py ./scripts/
RUN python scripts/export_onnx.py


FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY filmprint/ ./filmprint/
COPY api/ ./api/
COPY scripts/ ./scripts/
COPY pyproject.toml .

RUN pip install --no-cache-dir -e . --no-deps

# Copy model artifacts from builder — no torch or sentence-transformers in this stage
COPY --from=builder /app/data/ ./data/

EXPOSE 8000

CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}
