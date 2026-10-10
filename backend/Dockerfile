FROM python:3.12-slim

# Production reports are a Word template turned into a PDF by LibreOffice
# (api.services.production_report). The headless Writer is enough; Noto
# carries both the Latin text and the Bangla (item names, the taka sign).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-2}"]
