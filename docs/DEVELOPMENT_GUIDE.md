# Development guide

How to set up, run, test and contribute to Pilot EFB.

- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Running the project](#running-the-project)
- [Command reference](#command-reference)
- [Git workflow](#git-workflow)
- [Project rules](#project-rules)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Python | 3.11 or newer | The backend uses a typing feature added in 3.11 |
| Node.js | 20 or newer | Required by the test runner and router |
| npm | Bundled with Node.js | Installs frontend packages |
| Git | Any recent version | Version control |

The project was verified with Python 3.14.0 and Node.js 22.23.3 on macOS. No environment variables, accounts or credentials are needed.

## First-time setup

### 1. Get the code

```sh
git clone https://github.com/kanishkagupta88666/pilot-efb.git
cd pilot-efb
```

The working copy is about 40 MB because it includes the sample XML and PDF manuals.

### 2. Backend (from the repository root)

```sh
python3 -m venv backend/.venv
source backend/.venv/bin/activate        # Windows: backend\.venv\Scripts\activate
python -m pip install -r backend/requirements.txt
python backend/manage.py migrate
python backend/manage.py ingest_xml sample-data/xml/FM-S100_Rev2.xml
```

- `migrate` creates the database file `backend/db.sqlite3`.
- `ingest_xml` loads one manual revision. Until you run it, the API returns an empty library.

To load the whole sample set, run `ingest_xml` once for each file in `sample-data/xml/`.

### 3. Frontend (from `frontend/`)

```sh
cd frontend
npm install
```

Use `npm ci` instead of `npm install` when you want exactly the versions in the lockfile and no changes to `package-lock.json`.

## Running the project

Use two terminals.

**Terminal 1, from the repository root, with the virtual environment active:**

```sh
python backend/manage.py runserver 127.0.0.1:8000
```

**Terminal 2, from `frontend/`:**

```sh
npm run dev
```

Open the URL that Vite prints. Check the backend separately at `http://127.0.0.1:8000/api/health/`.

What to expect today:

- The frontend shows mock data and works even if the backend is stopped.
- The backend serves real ingested data, which you can inspect with a browser or `curl`.
- The two are not yet connected.

Keep the backend on port 8000. The Vite proxy in `frontend/vite.config.ts` forwards `/api` requests to `http://127.0.0.1:8000`.

## Command reference

### Run from the repository root

| Command | Purpose |
|---|---|
| `python backend/manage.py migrate` | Create or update database tables |
| `python backend/manage.py ingest_xml <path>` | Validate and store one XML manual revision |
| `python backend/manage.py ingest_xml <path> --replace` | Re-ingest a revision that is already stored |
| `python backend/manage.py runserver 127.0.0.1:8000` | Start the development API server |
| `python backend/manage.py test documents` | Run all 121 backend tests |
| `python backend/manage.py test documents.test_api` | Run only the API tests |
| `python backend/manage.py check` | Run Django's configuration checks |

The `<path>` given to `ingest_xml` is relative to the directory you run the command from.

### Run from `frontend/`

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the Vite development server on `127.0.0.1` |
| `npm test` | Run all frontend tests once |
| `npx tsc -b` | Type check without building |
| `npm run build` | Type check, then build into `frontend/dist/` |
| `npm run preview` | Serve the production build locally |

`npm run preview` does not proxy `/api`; the proxy applies only to `npm run dev`.

## Git workflow

The rules come from `CLAUDE.md`.

- **One branch per phase.** Name branches by purpose, following the existing pattern: `feature/...`, `docs/...`, `chore/...`.
- **Test, commit, then open a pull request** for each phase.
- **Never push to `main`.** All eleven changes so far reached `main` through merged pull requests.

A typical cycle:

```sh
git fetch origin
git switch -c feature/my-change origin/main
# make changes, run the relevant tests
git add <files>
git commit -m "Describe the change"
git push -u origin feature/my-change
# open a pull request on GitHub
```

### Ownership

| Area | Owner | Rule |
|---|---|---|
| `backend/` | Backend Development | Backend work only |
| `frontend/` | Frontend Development | Frontend work only |
| `contracts/` | Shared | Changes need the project owner's approval |
| Anything marked `PROVISIONAL` | — | Temporary and expected to change |

Backend Development and Frontend Development are two parallel streams of work. `CLAUDE.md` refers to them by internal working labels; the ownership rule is the same.

## Project rules

These are hard rules from `CLAUDE.md` and `.github/copilot-instructions.md`.

- **Synthetic data only.** Never add real operational documents.
- **Never generate or change node IDs** such as `fm100-t1193`. The ID is the permanent identity; the number is for display.
- **React never parses XML.** The backend validates, parses and serves JSON.
- **Search is non-generative.**
- **The UI uses sentence case and minimal taps.**
- **Never invent XML element types.** Check `sample-data/` first.
- **Anchor links, annotations and bookmarks to `id`**, never to `number` or page.

## Contributing

A suggested path for a new developer:

1. Read the root `README.md`, then `docs/PROJECT_STATUS.md` to see what is and is not built.
2. Read `sample-data/README.md` and `docs/xml-inspection.md` to understand the data.
3. Read `contracts/provisional-contract.md` for the JSON shapes, remembering that it is provisional and partly out of date (see `docs/PROJECT_STATUS.md`).
4. Set up the project and confirm both test suites pass before changing anything.
5. Work in the area you own, on a new branch.

Conventions visible in the existing code:

- **Backend:** type hints throughout; pipeline functions return result objects with structured issues instead of raising; anything that touches several tables runs inside one transaction; every new behaviour has a test.
- **Frontend:** function components with typed props; data access goes through `src/data/mockData.ts`; elements carry the permanent ID as their HTML `id`; tests query by accessible role and label.
- **Both:** arrays stay in XML source order and are never sorted by ID or number.

Before opening a pull request:

- Backend changes: `python backend/manage.py test documents` passes.
- Frontend changes: `npm test` and `npm run build` pass.
- Model changes include a migration created with `python backend/manage.py makemigrations`.
- `contracts/` is unchanged unless approval was given.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ImportError: cannot import name 'NotRequired' from 'typing'` | Python older than 3.11 | Recreate the virtual environment with Python 3.11 or newer |
| `ModuleNotFoundError: No module named 'django'` | Virtual environment not active | Activate it, then reinstall requirements if needed |
| `no such table: documents_document` | Migrations not applied | Run `python backend/manage.py migrate` |
| `/api/documents/` returns `{"documents": []}` | Nothing ingested yet | Run `ingest_xml` |
| `CommandError: Document FM-S100 revision 2 already exists.` | That revision is already stored | Add `--replace` |
| `Unable to read XML file` | Path is relative to a different directory | Run from the repository root or give a correct path |
| The frontend still shows one document after ingesting more | The frontend uses mock data | Expected until live integration is built |
| A MEL-S100 topic shows a paragraph but no MEL item | `melItem` blocks are skipped at ingestion | Expected; a known limitation |
| An API URL without a trailing slash returns a redirect | Django appends the slash | Use the trailing slash, or follow redirects (`curl -L`) |
| A browser request to an unknown `/api/` path shows JSON, not an HTML page | Intended behaviour of the API error middleware | None needed |
| Port 8000 is in use | Another process holds it | Stop it; the Vite proxy expects port 8000 |
| `npm test` or `npm run build` fails immediately on a fresh clone | Dependencies not installed | Run `npm install` in `frontend/` |

To start over with an empty database, stop the server, delete `backend/db.sqlite3`, and run `migrate` again. This removes all ingested data.
