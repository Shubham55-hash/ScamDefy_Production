# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# ScamDefy Backend API — Optimized Production Dockerfile
# Multi-stage build:
#   Stage 1 (builder): Compiles/installs CPU-only Python wheels into /opt/venv
#   Stage 2 (runner):  Hardened, minimal runtime with audio libraries & non-root user
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create clean virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Pre-install CPU-only PyTorch & torchaudio to prevent downloading ~5GB NVIDIA CUDA wheels
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
    "torch>=2.3.0" \
    "torchaudio>=2.0.0"

# Install remaining application dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt


# ── Stage 2: Production Runtime ───────────────────────────────
FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8000

# Install runtime audio codecs (FFmpeg, libsndfile) and curl for container health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged runtime user and group (Principle of Least Privilege)
RUN groupadd -g 10001 scamdefy && \
    useradd -u 10001 -g scamdefy -s /bin/bash -m scamdefy

# Copy virtual environment from builder stage
COPY --from=builder /opt/venv /opt/venv

# Prepare runtime directories with non-root ownership
RUN mkdir -p /app/data /app/tmp && \
    chown -R scamdefy:scamdefy /app

# Copy application source code with non-root user permissions
COPY --chown=scamdefy:scamdefy . /app

# Switch to non-root user
USER scamdefy

EXPOSE 8000

# Container healthcheck using FastAPI health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "index:app", "--host", "0.0.0.0", "--port", "8000"]
