# Frontend guide

Pilot EFB is a React, TypeScript and Vite single-page app in `frontend/`. It
provides a document library and an iPad-responsive XML reader. Use synthetic
sample data only; the UI does not parse XML.

## Run the frontend

Install dependencies and start the development server from `frontend/`:

```sh
npm ci
npm run dev
```

Mock mode is the default and does not require Django. To use the live read-only
Django APIs, start Django at `http://127.0.0.1:8000` in another terminal and
run:

```sh
VITE_DATA_SOURCE=api npm run dev -- --port 5177
```

The Vite development proxy forwards `/api` requests to Django. API mode never
falls back to mock data: request failures are shown with an error and retry
action. Configure `VITE_API_BASE_URL` when the API is hosted at a different
base URL; the Vite proxy is only available in development.

Useful checks, also from `frontend/`:

```sh
npm test
npx tsc -b
npm run build
```

## Routes and data flow

`frontend/src/App.tsx` defines these routes:

| Route | Purpose |
|---|---|
| `/` | Document library |
| `/reader/:docId/:revision` | Reader for one explicit document revision |
| `/open?doc=FM-S100&node=fm100-p00673&rev=2` | Provisional permanent-ID resolver route; `rev` is optional |

The library loads revisions from the selected data source. In API mode, the
revision marked `current` is selected initially; explicit reader revisions are
not silently replaced. The backend resolver chooses the current effective
revision when `rev` is omitted.

API calls live in `frontend/src/api/client.ts`. It validates JSON response
shapes and returns explicit network, HTTP and invalid-response errors. The API
reader fetches the library and complete revision navigation, then requests only
the selected topic. API cross-references are resolved only after activation.
The API reader does not depend on the mock adapter.

Mock mode uses `frontend/src/data/mockData.ts`, which adapts
`contracts/provisional-sample.json`. It contains the source-backed sample topic
and the separately labeled `MOCK` table-rendering example. It is intentionally
not a complete manual. Mock mode cannot resolve IDs outside those local topics.

## Reader behavior

The reader displays the chapter → section → topic hierarchy from the selected
revision, with expand/collapse controls and one topic's content at a time.
Content blocks, table rows/cells, checklist checks and inline text/xref
segments render in source order. Lists are bulleted. Table rows flagged as
headers use table-header cells. Checklist checkboxes are local UI state and
are not saved.

Paragraph, callout, list, table, checklist, checklist-check, topic, chapter and
section targets use permanent XML IDs. The reader expands the required
navigation path, scrolls the target into view and highlights it temporarily.
Numbers and titles are display labels, never target identity.

The `/open` route calls the permanent-ID resolver and navigates to the exact
document, revision, topic and target returned by Django. The sample
`sample-data/deep_link_samples.json` fixtures appear in the API-mode library as
simulated external-application links. They omit `rev` to exercise current
effective revision selection. These are development examples, not a finalized
external URL contract.

Cross-references in API mode are lazy: activating a reference calls the
resolver. A resolvable target opens at its returned location; an unavailable
target is shown as non-clickable text. In mock mode, only targets in the local
mock data become links.

The reader footer displays the document's `classification` metadata value.
There is no separate SSI marking field in the current API or provisional
metadata contract.

## Content rendering and errors

`frontend/src/components/ContentBlocks.tsx` renders `para`, `note`, `caution`,
`warning`, `list`, `table` and `checklist` blocks. Note, caution and warning
labels use neutral styling rather than severity colors. Target highlighting
also uses neutral styling.

Loading, empty and request-error states are explicit. API errors include a
retry action. Invalid document, node and revision requests are reported; an
explicit unavailable revision is never substituted with another revision.
The complete reader can show revisions, loading states and backend errors
from the live API. Mock mode shows only the sample's available data.

## Responsive layout

Styles are in `frontend/src/styles.css`. On narrow and portrait layouts the
outline opens as a touch-friendly drawer. At 900px wide, or at 760px wide in
landscape, the outline and topic are displayed side by side. Reader content
uses a bounded text width; wide tables remain horizontally scrollable.

Browser viewport checks can exercise iPad-sized layouts, but they do not
certify a physical iPad or assistive-technology behavior.

## Tests

Vitest and React Testing Library tests are in `frontend/src/`. They cover mock
content, API loading and errors, revision selection, the supplied simulated
links, source ordering, the block renderers, cross-reference behavior, and
permanent-ID resolver routing and target highlighting. Live browser checks
against Django should be reported separately from automated test results.
