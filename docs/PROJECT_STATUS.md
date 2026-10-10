# Project status

A factual snapshot of what exists in the repository, based on the code on `main` after the read-only REST API (pull request #11) was merged.

This page describes the code, not the plan. A feature counts as implemented only if working code and tests exist for it.

## Summary

| Area | State |
|---|---|
| Backend XML pipeline | Implemented and tested |
| Backend database and ingestion | Implemented and tested on SQLite |
| Backend REST API | Three read-only document endpoints and a health check, implemented and tested |
| Frontend reader | Implemented and tested against mock data |
| Frontend-to-backend connection | Not implemented |
| PDF, search, annotations, bookmarks, offline, authentication | Not implemented |

## Delivery history

| Pull request | Delivered |
|---|---|
| #1 | Project foundation and synthetic dataset |
| #2 | XML inspection report (`docs/xml-inspection.md`) |
| #3 | Provisional JSON contract (`contracts/`) |
| #4 | XSD validation (Step 5A) |
| #5 | Document library and XML reader prototype (frontend) |
| #6 | Metadata extraction (Step 5B) |
| #7 | Hierarchy extraction (Step 5C) |
| #8 | Topic content extraction (Step 5D) |
| #9 | Normalized document assembly (Step 5E) |
| #10 | Validated database ingestion (Step 5F) |
| #11 | Read-only document REST API (Step 5G) |

"Step 5A" to "Step 5I" are milestone names from the project plan. They are not identifiers in the code: no module, function or command is named after a step. The mapping of each name to a module follows the build order in `CLAUDE.md` (validation, metadata, hierarchy, block types, normalized JSON, database) and the order of the merges.

## Implemented

### Backend

- **XML validation** against the XSD with a parser that blocks external entities, DTDs and network access.
- **Metadata extraction** with a consistency check between root attributes and `meta` values.
- **Hierarchy extraction** of chapters, sections and topics in source order.
- **Content extraction** for `para`, `note`, `caution`, `warning`, `list`, `table` and `checklist`, including inline cross-references and permanent checklist-item IDs.
- **Cross-reference and duplicate-ID checks** at extraction time.
- **Normalized assembly** into one payload with a separate ingestion report.
- **Atomic ingestion** through `manage.py ingest_xml`, with duplicate protection, `--replace`, rollback on any failure and post-write tree validation.
- **Data model** of `Document`, `DocumentVersion` and `DocumentNode` with six database constraints.
- **REST API:** health, document library, navigation tree and topic content.
- **Revision status** (`current`, `upcoming`, `superseded`) derived from effective dates on each request.
- **Uniform JSON errors** with sanitized internal failures.
- **121 automated tests.**

All eight sample XML manuals were ingested successfully during verification. Automated tests exercise FM-S100 Rev 2 and small synthetic fixtures.

### Frontend

- **Document library page** with one card per revision.
- **Reader page** with a toolbar, collapsible three-level outline and topic view.
- **Renderers** for all seven supported block types.
- **Interactive checklists** (in-memory only).
- **Cross-reference links** that open the target topic.
- **Deep links by permanent ID** through a `?nodeId=` query, with scroll and highlight.
- **Responsive layout** with a navigation drawer on narrow screens and a sidebar on wide ones.
- **10 automated tests.**

Everything in the frontend list runs on mock data limited to one document, one revision and two topics.

## In progress

No partially built feature exists on `main`. Work that may exist on unmerged branches is not described here.

## Planned, not implemented

| Item | What is missing |
|---|---|
| Step 5H: deep-link resolver | No route or view for `resolve-node`. The contract proposes it; requesting it returns 404 |
| Step 5I: live frontend integration | No API calls in the frontend; no loading or error states |
| Revision status in the UI | The API provides it; the library does not show it |
| PDF viewer | No viewer, no PDF library, no ID-to-PDF mapping |
| Search | Nothing built. The project rule is that search must be non-generative |
| Annotations | Nothing built. Test cases exist in `sample-data/revision-keys/annotation_test_cases_Rev1_to_Rev2.json` |
| Bookmarks | Nothing built |
| Revision comparison | Nothing built. Expected differences exist in `sample-data/revision-keys/` |
| Offline/PWA | No service worker, web app manifest or offline storage |
| Authentication | None. The API allows all requests |
| PostgreSQL | Not configured or tested |
| Deployment | No production settings, hosting configuration or continuous integration |

## Known limitations

### Data and ingestion

- **`melItem` blocks are skipped.** They are reported during ingestion but not stored. Each of the 112 topics in MEL-S100 has one paragraph and one `melItem`, so those topics are served with the paragraph only and the MEL item itself is missing.
- **Blocks are stored as JSON inside topics.** Paragraph, table, checklist and check IDs are preserved but cannot be looked up by a database query.
- **List items and table cells are plain strings.** They carry no IDs, matching the XSD.
- **One file per command.** There is no batch ingestion, and the XSD path cannot be changed from the command line.
- **No removal command.** A stored revision can be replaced but not deleted through the tooling.
- **Document title follows the last ingestion.** `Document.title` is overwritten each time any revision of that document is ingested. The API reads titles from each version's metadata, so responses are unaffected.

### API

- **Library order.** Documents are ordered by ID. The contract asks for source or manifest order, which is not stored; a code comment records this.
- **No pagination.** The navigation endpoint returns the whole outline (1,283 nodes for FM-S100 Rev 2).
- **No caching headers or rate limiting.**
- **Open access.** Suitable for a local prototype only.

### Frontend

- **Mock data only.**
- **Checklist ticks are not saved.**
- **No revision switcher** inside the reader.
- **No real-device testing**, including iPad.
- **No lint or formatting configuration.**

### Configuration

- `backend/config/settings.py` hardcodes `DEBUG = True` and a placeholder secret key, and reads no environment variables. `backend/.env.example` is therefore unused.
- The backend has no dependency lockfile, so installed versions can drift within the ranges in `backend/requirements.txt`.

## Documentation that is out of date

These files are owned or controlled elsewhere and were left unchanged.

| File | Issue |
|---|---|
| `contracts/provisional-contract.md` | Marks every endpoint "PROPOSED, not implemented" and ends by saying no endpoint, parser, model or database is implemented. Three of its four endpoints now exist |
| `contracts/provisional-contract.md` | Its error table lists `422 UNSUPPORTED_NODE_TYPE` (not implemented) and omits `NODE_NOT_A_TOPIC`, `NOT_FOUND`, `METHOD_NOT_ALLOWED` and `NOT_ACCEPTABLE` (implemented) |
| `contracts/provisional-contract.md` | Describes revision `status` as illustrative and not date-based. The backend now derives it from dates |
| `sample-data/README.md` | States that PDF outline entries are keyed to XML IDs. `docs/xml-inspection.md` found no such IDs in the inspected PDF |
| `docs/xml-inspection.md` | Says it "does not implement XML ingestion" and refers to a future PostgreSQL schema. Accurate when written; ingestion has since been built on SQLite |

## Remaining technical decisions

Open questions recorded in the contract and the inspection report, plus those raised by the current code.

1. **Block-level deep links.** How should the resolver find a paragraph or checklist item, given that blocks live inside topic JSON? Options include a lookup table of block IDs or searching the JSON.
2. **Default revision.** What should happen when a link names no revision? The contract proposes the currently effective revision but marks this as not approved.
3. **Time basis for "current".** Status uses the server's date in UTC. Whether that is the right clock for pilots in other time zones is undecided.
4. **Chapter and section targets.** Should deep links to a chapter or section be supported? The topic endpoint currently answers `NODE_NOT_A_TOPIC`.
5. **Inbound link format.** The external application's URL format is unknown. The frontend currently uses `/reader/{docId}/{revision}?nodeId={id}`.
6. **PDF mapping.** Where does the mapping from permanent XML IDs to PDF locations come from? It is absent from the sample PDFs, manifest and revision keys.
7. **PDF-only documents.** How should the two bulletins, which have no XML, be listed and opened?
8. **`melItem` support.** Should MEL content be rendered, and in what JSON shape?
9. **Whitespace.** Block text is currently stored exactly as parsed. Whether to normalize it for display is unresolved in the contract.
10. **Cross-document references.** The sample contains only in-document cross-references. Whether references between documents are expected is unknown.
11. **Outline size.** Whether the full navigation tree should be paginated or loaded lazily.
12. **Database.** Whether and when to move to PostgreSQL, and how to test it.
13. **Contract status.** When the provisional contract should be updated to reflect the implemented API.
14. **Production configuration.** How settings, secrets and the frontend's API location will be provided outside local development.
