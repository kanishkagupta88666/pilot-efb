# Pilot EFB

Pilot EFB is an iPad-friendly progressive web app prototype for reading aviation manuals in XML and PDF formats, created for a university consulting project. The foundation uses React, TypeScript, and Vite on the frontend with Django, Django REST Framework, and lxml on the backend; SQLite is the development database. All project data must be synthetic.

## Project folders

- `backend/` — backend work (session A)
- `frontend/` — frontend work (session B)
- `contracts/` — shared contracts; changes require approval
- `docs/decisions/` — project decisions
- `sample-data/xml/` — XML manual samples
- `sample-data/pdf/` — PDF manual samples
- `sample-data/pdf-only/` — PDF-only samples
- `sample-data/schema/` — XML schemas
- `sample-data/revision-keys/` — revision-key samples

## Prerequisites

- Python 3.10 or newer
- Node.js 20 or newer and npm

## Backend setup

From the repository root, create and activate a Python virtual environment:

```sh
python3 -m venv backend/.venv
source backend/.venv/bin/activate
```

Install the backend dependencies and apply the initial database migrations:

```sh
python -m pip install -r backend/requirements.txt
python backend/manage.py migrate
```

Start Django on `127.0.0.1:8000`:

```sh
python backend/manage.py runserver 127.0.0.1:8000
```

The development settings use SQLite. `backend/.env.example` documents local environment values; it contains no credentials and is not needed to run the development server.

## Frontend setup

In another terminal, install the frontend dependencies and start Vite:

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite.

## Tests

Run the Django automated tests from the repository root:

```sh
python backend/manage.py test
```

Create a production frontend build with:

```sh
cd frontend
npm run build
```

## Frontend and backend connection

The homepage requests `/api/health/` and displays the backend connection status. During local development, Vite proxies `/api` requests to Django at `http://127.0.0.1:8000`; the frontend uses a relative API path and does not hardcode a production backend URL.
