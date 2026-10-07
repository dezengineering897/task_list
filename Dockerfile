FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# SQLite database lives here — mount a volume at this path to persist data
# across container restarts/rebuilds/redeploys.
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data

# Run as a non-root user, owning both the app and its data directory
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
VOLUME ["/app/data"]

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/healthz')" || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "3", "app:app"]
