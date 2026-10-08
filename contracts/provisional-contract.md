# Pilot EFB JSON contract

> **PROVISIONAL — subject to frontend/backend review**
>
> Design only. These endpoints and JSON shapes are **PROPOSED, not
> implemented**. This first-cycle contract covers FM-S100 Rev 2 XML content
> rendering and deep links to original XML node IDs. It does not define XML
> ingestion, persistence, PDF navigation, or application code.

The source examples are taken from `sample-data/xml/FM-S100_Rev2.xml`. XML
namespace: `urn:sample:fltpub:1.0`. The complete example bundle is
[`provisional-sample.json`](./provisional-sample.json).

## Identity and versions

- A **Document** is the stable logical manual. `document.id` is the source
  root's `manual/@id` and equals `meta/docId` for this sample (`FM-S100`).
  Preserve it exactly. `namespace` and the source `docType` identify its XML
  vocabulary and document kind.
- A **DocumentVersion** is one explicitly selected revision of a document.
  `revision`, revision/effective dates, and every field from the XML `meta`
  belong to the version. Document Library and navigation responses include a
  `metadata` object preserving the exact source field names: `docId`, `title`,
  `docType`, `applicability`, `revision`, `revisionDate`, `effectiveDate`,
  `owner`, `changeSummary`, and `classification`. To reduce repeated data, a
  topic-content response includes only `revision`, `revisionDate`, and
  `effectiveDate` in its `version` object.
- `id` is permanent identity; `number` is a positional display value. Preserve
  source IDs as-is; never derive, regenerate, or replace them with a number,
  title, or page.
- These arrays preserve exact XML source order: chapters, sections, and topics;
  topic content blocks; table rows and cells; checklist checks; and mixed-text
  and xref segments. The frontend must not sort any of these arrays by ID or
  positional number. A missing optional field is omitted, not fabricated.
  XML mixed content is represented by ordered segments, never flattened
  across inline elements.

JSON types below use `string`, `integer`, `boolean`, `array`, and `object`.
Dates are ISO `YYYY-MM-DD` strings.

## Proposed endpoint: Document Library

**PROPOSED, not implemented**

```http
GET /api/documents/
```

Returns supported logical documents and their published/available revisions.
For this cycle, the example lists only FM-S100 Rev 2 as supported; this is a
cycle-scope statement, not a claim that other source revisions do not exist.
The endpoint must not advertise a revision as available unless the service
can serve it.

```json
{
  "documents": [
    {
      "id": "FM-S100",
      "namespace": "urn:sample:fltpub:1.0",
      "docType": "FM",
      "availableRevisions": [
        {
          "revision": 2,
          "revisionDate": "2026-07-01",
          "effectiveDate": "2026-07-15",
          "status": "current",
          "metadata": {
            "docId": "FM-S100",
            "title": "Sample Flight Manual - SAMPLE-100",
            "docType": "FM",
            "applicability": "SAMPLE-100",
            "revision": 2,
            "revisionDate": "2026-07-01",
            "effectiveDate": "2026-07-15",
            "owner": "Sample Flight Standards",
            "changeSummary": "Reorganization revision. Topics relocated between sections, five topics removed, text updates and new topics.",
            "classification": "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE"
          }
        }
      ]
    }
  ]
}
```

Fields:

- `documents`: required array of Document summaries, source/manifest order.
- `id`, `namespace`, `docType`: required strings for stable document identity.
- `availableRevisions`: required array, possibly empty. Each entry has required
  integer `revision`, required `revisionDate` and `effectiveDate` date strings,
  required `status` string (proposed values: `current`, `upcoming`,
  `superseded`) and required `metadata`. The sample's `status: "current"` is
  illustrative of the dataset's stated current revision, not an implemented
  date-based revision-selection algorithm.
- `metadata`: required object preserving all ten source `meta` fields and
  source JSON types: strings except integer `revision`.

## Proposed endpoint: navigation tree

**PROPOSED, not implemented**

```http
GET /api/documents/{docId}/revisions/{revision}/navigation/
```

The URL selects one exact version. Response metadata identifies that selected
version, and the tree contains only navigation fields—not topic blocks. The
sample's `status: "current"` is illustrative of the dataset's stated current
revision, not an implemented date-based revision-selection algorithm:

```json
{
  "document": {
    "id": "FM-S100",
    "namespace": "urn:sample:fltpub:1.0",
    "docType": "FM"
  },
  "version": {
    "revision": 2,
    "metadata": {
      "docId": "FM-S100",
      "title": "Sample Flight Manual - SAMPLE-100",
      "docType": "FM",
      "applicability": "SAMPLE-100",
      "revision": 2,
      "revisionDate": "2026-07-01",
      "effectiveDate": "2026-07-15",
      "owner": "Sample Flight Standards",
      "changeSummary": "Reorganization revision. Topics relocated between sections, five topics removed, text updates and new topics.",
      "classification": "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE"
    }
  },
  "chapters": [
    {
      "id": "fm100-c05",
      "number": "05",
      "title": "Non-Normal Procedures",
      "sections": [
        {
          "id": "fm100-s019",
          "number": "05.10",
          "title": "Air Systems",
          "topics": [
            {
              "id": "fm100-t0340",
              "number": "05.10.16",
              "title": "Autothrottle Crew Awareness"
            }
          ]
        }
      ]
    }
  ]
}
```

`document`, `version`, `chapters`, and every nested collection are required.
Each chapter, section, and topic has required `id`, `number`, and `title`
strings. Chapters contain ordered `sections`; sections contain ordered
`topics`. A topic outline item deliberately has no `blocks`. The example is a
small excerpt; a successful endpoint response returns the complete outline
for the selected version.

## Proposed endpoint: one topic's content

**PROPOSED, not implemented**

```http
GET /api/documents/{docId}/revisions/{revision}/topics/{topicId}/
```

Returns exactly one topic, including all blocks in source order. It repeats
document/version identity so the payload is self-describing. `chapterId` and
`sectionId` identify the topic's source parents. The full source-backed
example, including a checklist and inline cross-reference, is in
[`provisional-sample.json`](./provisional-sample.json).

Required response fields:

- `document`: required `{ "id": string, "namespace": string, "docType": string }`.
- `version`: required `{ "revision": integer, "revisionDate": date string,
  "effectiveDate": date string }`. It is intentionally compact and contains no
  repeated `metadata` object.
- `topic`: required object with `id`, `number`, `title`, `chapterId`,
  `sectionId` strings, and `blocks` array.
- Each block is an ordered, discriminated object with required `type` and
  original `id`. `type` is one of `para`, `note`, `caution`, `warning`,
  `list`, `table`, or `checklist`. `melItem` is excluded from this cycle.
  Block IDs and nested check IDs are source IDs, not generated IDs.

Block-specific fields:

- `para`, `note`, `caution`, `warning`: required `segments` array, ordered as
  in XML. A text segment is `{ "type": "text", "text": string }`. An inline
  cross-reference segment is `{ "type": "xref", "targetId": string,
  "text": string }`; `targetId` is the original `xref/@target` permanent ID,
  and `text` is the original displayed text. Keep mixed text before and after
  xrefs in separate ordered segments. Whitespace preservation versus
  normalization in segment strings remains unresolved. The XSD permits xrefs in all four text
  block types, including `note`, `caution`, and `warning`; the contract must
  support them even though the shown sample xref is in a paragraph.
- `list`: required `items` array of strings in source order. The `item`
  children have no IDs in this XSD.
- `table`: required `rows` array in source order; each row has required
  `cells` array of strings in source order. Optional `header` is a boolean and
  is omitted when the XML row has no `header` attribute.
- `checklist`: required `checks` array in source order. Each check has required
  original `id`, `challenge` string, and `response` string.

The JSON sample also has a separately labeled table example from topic
`fm100-t1086`; its XML `header="true"` row is represented by JSON boolean
`"header": true`, and all cells remain in row/source order.

The XSD allows `warning`, but warning occurs in none of the supplied XML files.
It is described here as a supported schema variant; no warning instance or
example is invented.

## Proposed endpoint: resolve a permanent-ID deep link

**PROPOSED, not implemented**

```http
GET /api/documents/{docId}/resolve-node/?revision={revision}&nodeId={nodeId}
```

`docId` and `nodeId` are required. `revision` is optional only while the
default policy is unresolved; clients should send an explicit revision for
deterministic navigation. The response always reports the selected revision.
A topic target opens that exact topic. A supported nested content target
resolves to its containing topic and returns the exact `targetNodeId` for
scrolling/highlighting. It also returns all hierarchy breadcrumbs required to
expand the outline.

The complete proposed set of supported `targetType` values is `topic`, `para`,
`note`, `caution`, `warning`, `list`, `table`, `checklist`, and `check`.
`topic` targets open the topic itself. The remaining types are addressable
content nodes within a topic; a `check` target is nested inside a `checklist`.
`warning` is supported by the XSD but absent from all supplied XML files.
Chapter and section targets are not in this proposed set pending the
unresolved decision below.

Paragraph- and checklist-item-level examples are provided separately in
[`provisional-sample.json`](./provisional-sample.json).

```json
{
  "documentId": "FM-S100",
  "selectedRevision": 2,
  "chapterId": "fm100-c03",
  "sectionId": "fm100-s008",
  "topicId": "fm100-t0097",
  "targetNodeId": "fm100-p00673",
  "targetType": "para",
  "topic": {
    "id": "fm100-t0097",
    "number": "03.10.1",
    "title": "Briefing: Fuel Crossfeed"
  }
}
```

This is the actual source-backed paragraph target. It has no title of its own;
its containing topic provides the display title. The full request/response
sample is in [`provisional-sample.json`](./provisional-sample.json).
The React client uses the breadcrumbs to expand chapter and section, opens the
topic by permanent ID, then locates `targetNodeId` in its rendered topic. It
does not resolve IDs from a positional number, title, or PDF page.

### Revision selection remains unresolved

Revision selection policy remains unresolved. Clients should supply an
explicit revision for deterministic navigation. If omitted, **opening the
currently effective revision is only a proposed default and is not approved**.
The sample's `"status": "current"` is illustrative of the dataset's stated
current revision, not an implemented date-based revision-selection algorithm.
Do not infer that the API implements status selection. The default, time basis,
overlap selection, and behavior for an upcoming-only or expired document
require approval.

### PDF is separate

XML deep-link resolution does not resolve to PDF pages. The inspected PDF,
manifest, and revision keys contain no verified permanent-XML-ID-to-PDF
destination mapping. A future PDF workflow would require a separately
verified/publisher-supplied mapping or explicit ID-bearing PDF destinations;
neither is defined or fabricated here. Mapping format and PDF fallback behavior
are awaiting client clarification.

## Proposed error response

**PROPOSED, not implemented**

All API errors use this JSON shape:

```json
{
  "error": {
    "code": "NODE_NOT_FOUND",
    "message": "The node ID does not exist in the selected document revision."
  }
}
```

`error.code` and `error.message` are required strings. Optional `details` is an
object for safe field-specific information; it must not contain credentials or
raw internal exceptions. Proposed status/code pairs:

| HTTP status | `error.code` | Use |
|---:|---|---|
| 400 | `INVALID_REQUEST` | Missing/malformed required `docId`, `nodeId`, or revision syntax |
| 404 | `DOCUMENT_NOT_FOUND` | Unknown `docId` |
| 404 | `REVISION_NOT_FOUND` | Revision is not available for the document |
| 404 | `NODE_NOT_FOUND` | Permanent ID is not present in the selected document revision |
| 422 | `UNSUPPORTED_NODE_TYPE` | Node exists but is outside this cycle's deep-link targets (for example, a section) |
| 500 | `INTERNAL_ERROR` | Unexpected server error, without implementation details |

An unknown revision must not silently fall back to a different revision. An
unresolved revision default is distinct from an invalid explicitly selected
revision.

## How React consumes these responses

1. Call the Document Library endpoint and show each document with its
   available revision and effective date.
2. Request the navigation tree for a selected explicit revision; render the
   chapter → section → topic outline in exact XML source order, using original
   IDs as keys and numbers/titles as display labels. Do not sort these arrays
   by ID or positional number.
3. Request a topic only when selected. Render its blocks in exact XML source
   order by `type`; render text/xref segments in order; preserve table row and
   cell order and checklist check order; and make xrefs navigate by `targetId`.
   Do not sort these arrays by ID or positional number.
4. For an inbound deep link, request resolution with the requested revision and
   permanent node ID, expand the returned breadcrumb IDs, fetch the topic,
   and scroll/highlight the exact nested target ID.
5. Do not infer XML/PDF mapping from the outline or treat a number as identity.

## Unresolved design decisions

- **Unspecified revision:** Defaulting to the currently effective revision is
  proposed, not approved. Define clock/time-zone source, overlap selection,
  and no-current-revision behavior. The example's `status: "current"` is
  illustrative of the dataset's stated revision status, not the output of an
  implemented date-based algorithm.
- **Chapter and section links:** Should chapter and section IDs be supported
  as deep-link targets? Supporting them is recommended so inbound navigation
  can open the relevant outline level, but this is not finalized; the current
  proposed `targetType` set excludes them.
- **Inbound frontend route:** The external application's route format is
  unknown. One possible query shape is
  `/reader?docId=FM-S100&nodeId=fm100-p00673&revision=2`, with revision
  optional. Confirm the actual route and parameter encoding with the external
  application.
- **Inline xrefs:** Must be supported inside `para`, `note`, `caution`, and
  `warning`, as allowed by the XSD. Confirm whether cross-document xrefs are
  expected; the sample only verifies in-document targets.
- **Mixed-text whitespace:** Decide whether segment strings preserve parsed XML
  text/tail whitespace exactly or normalize it for display. Segment order and
  the distinction between text and xref segments must be retained either way.
- **PDF destinations:** Permanent XML-ID-to-PDF mapping is unresolved and
  awaiting client clarification. No mapping exists in the inspected sample.
- **Document type fields:** The XML root and `meta` both provide document ID
  and type. This proposal surfaces stable identity separately from version
  metadata while preserving all original `meta` values; confirm whether
  duplicated `docId`/`docType` fields are desired in API payloads.
- **Outline scale and pagination:** The sample shows an excerpt, while the
  proposed navigation endpoint returns the complete tree. Confirm whether
  pagination or lazy section loading is needed for the full manual.
- **Unsupported addressable nodes:** Confirm whether chapter/section and
  future `melItem` nodes should be resolvable in a later cycle. They are not
  content targets in this provisional first-cycle resolver.

This document and its JSON sample are **PROVISIONAL — subject to
frontend/backend review**. No endpoint, parser, model, database, or UI is
implemented by this proposal.
