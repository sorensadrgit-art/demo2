# KineLab biomechanics backend (R1 production).
# Non-root, read-only code, writable data/cache/logs volumes only.
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd -m -u 10001 kinelab && mkdir -p /app /data /cache /logs \
  && chown -R kinelab:kinelab /app /data /cache /logs
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir fastapi==0.141.1 uvicorn==0.52.4 pydantic==2.13.5 \
  numpy==2.5.3 scipy==1.18.1 opencv-python-headless==4.12.0.88 httpx==0.28.1
COPY app ./app
USER kinelab
EXPOSE 8101
ENV KINELAB_BACKEND_HOST=0.0.0.0 KINELAB_BACKEND_PORT=8101 \
  KINELAB_STORAGE_ROOT=/data PYTHONPATH=/app
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8101/health',timeout=8).status==200 else 1)"
CMD ["sh", "-c", "python -c \"from app.config import validate_startup; p=validate_startup(); print('config:', p if p else 'OK'); raise SystemExit(1 if p else 0)\" && exec uvicorn app.main:app --host ${KINELAB_BACKEND_HOST:-0.0.0.0} --port ${KINELAB_BACKEND_PORT:-8101}"]
