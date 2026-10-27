#!/bin/sh
# Start the API for the browser tests: a fresh database, every sample manual
# ingested, then the development server on port 8100.
#
# Run from anywhere. Needs the backend dependencies installed; set E2E_PYTHON
# to the interpreter of the backend virtual environment if python3 is not it.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${E2E_PYTHON:-python3}"
export DJANGO_SETTINGS_MODULE=config.settings_e2e
export EFB_E2E_DB="${EFB_E2E_DB:-$(mktemp -d)/e2e.sqlite3}"
cd "$ROOT"
"$PY" backend/manage.py migrate --noinput >/dev/null
for xml in sample-data/xml/*.xml; do
  "$PY" backend/manage.py ingest_xml "$xml" >/dev/null
done
for pdf in sample-data/pdf-only/*.pdf; do
  "$PY" backend/manage.py ingest_pdf "$pdf" >/dev/null
done
exec "$PY" backend/manage.py runserver 127.0.0.1:8100 --noreload
