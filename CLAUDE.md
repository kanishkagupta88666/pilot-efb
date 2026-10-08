# Pilot EFB Project Rules

Pilot EFB is an iPad-friendly PWA prototype for reading aviation manuals in XML and PDF formats, built for a university consulting project. The planned stack is React, TypeScript, and Vite on the frontend, with Django, Django REST Framework, lxml, and SQLite on the backend; PostgreSQL may be used later. Use synthetic data only.

## Hard rules

- Use synthetic data only.
- Never generate or change client node IDs (for example, `fm100-t1193`). The ID is the permanent identity; the number is display only.
- React never parses XML. The backend validates XML against the XSD, parses it with lxml, and serves JSON.
- Search is non-generative.
- The UI uses sentence case and minimal taps.
- Never invent XML element types. Inspect `sample-data/` first.

## Ownership

- `backend/` is session A only.
- `frontend/` is session B only.
- `contracts/` is shared and changes only with my approval.
- Anything marked `PROVISIONAL` is temporary.

## Parser development

Build the parser in small steps, in this order: validation, metadata, hierarchy, block types, normalized JSON, database. Implement one step per prompt.

## Workflow

Use one branch per phase. Test, commit, and open a pull request for each phase. Never push to `main`.

## Client XML Dataset Rules

- `id` is permanent across revisions; `number` is positional and may change. Anchor deep links, annotations, and bookmarks to `id`, never to `number` or page.
- Blocks have permanent IDs too. PDF outline entries use the same IDs as the XML.
- First development cycle scope: FM-S100 Rev 2 only. `sample-data/README.md` describes the synthetic client dataset.