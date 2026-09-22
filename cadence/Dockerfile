# ---------- Stage 1: build the web UI ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: Python runtime ----------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    CADENCE_DATA_DIR=/data \
    CADENCE_STATIC_DIR=/app/static
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY backend/pyproject.toml backend/README.md ./
COPY backend/cadence ./cadence
RUN pip install --no-cache-dir .
COPY --from=web /web/dist ./static
COPY run.sh /run.sh
RUN chmod +x /run.sh
EXPOSE 8099
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD curl -fsS http://127.0.0.1:8099/api/health || exit 1
CMD ["/run.sh"]
