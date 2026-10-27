<!--
Repository note (not part of the guide).

Source: Team 1 (Pilot DMS). Original attachment name: Pilot_DMS_Integration_Guide_for_Pilot_EFB.md.
This copy was rebuilt from a plain-text extraction of that attachment. Headings, tables, lists
and code fences were restored where the structure was clear; the wording, field names, routes,
examples and values are unchanged. Inline code formatting was lost in extraction and has been
re-added only in the route column of section 3 and around text containing angle brackets.

This file is kept as received. It still contains the section 10 example that Team 1 later
corrected. Corrections and later agreements are in pilot-dms-guide-v2-clarifications.md.
Do not edit the text below; record changes in the clarifications file.
-->

# Pilot DMS → Pilot EFB: integration guide

Version 2 · October 2026 · from Team 1 (Pilot DMS) to the Pilot EFB team

What Pilot DMS gives your app, how to fetch it, what the XML looks like, how a deep link
resolves, and what to do when a revision changes. The same data is available live over HTTP
and as a release package file, so the handoff can be either.

Version 2 adds the XML structure for your parser, the manifest and tree shapes, the deep-link
rules, the error responses and the file-only variant of the demo. Nothing from version 1
changed meaning.

## 1. Three rules the whole format rests on

- Node IDs are permanent; numbers are positional. fm100-t0043 is the same topic in every
  revision even when its number moves from 02.20.3 to 03.50.4. Anchor annotations, bookmarks
  and links to IDs; display numbers.

- A released revision never changes. A correction is a new revision. Cache anything by
  revision id for as long as you like.

- State comes from dates. effectiveDate decides: a revision is scheduled before it,
  in_force from it, superseded once a later one is in force. You may receive a scheduled
  revision early; keep showing the one in force until the date.

Only released revisions are visible on this interface. Drafts and reviews do not exist for
your app.

## 2. Access

| | |
|---|---|
| Base URL | Shared by Team 1 when the demo server is up. Local development: http://localhost:8000 |
| Authentication | Header `Authorization: Bearer <token>`. One token per app instance, issued by Team 1 and handed over privately. It reads released content only, does not expire in the prototype, and we can deactivate it. Keep it in your app’s configuration, not in source control. |
| Conventions | JSON; keys in camelCase; dates YYYY-MM-DD; timestamps ISO 8601 in UTC (Z). id is our integer record id and is what routes take; nodeId is a string. number is the revision number (what you call the version); label is its display form (Rev 3, Issue 1). Interactive docs at /api/docs/. |
| Time zone | Effective dates switch at local midnight in the prototype’s time zone (America/Chicago). The in_force event in section 7 shows that moment in UTC. |
| Calling from a browser | Server-side and native calls need nothing more. If your app calls the API straight from a browser on another origin, tell us the origin and we allow it. |
| Limits | No rate limit on the public API in the prototype. The largest package is about 9 MB. |
| Sample data today | The client’s sample set (XML, PDF, the XSD, revision keys, deep-link samples) is served at https://manojkmohan5.github.io/Pilot-DMS/data/, so parsing and rendering work can start before the demo server is up. |

## 3. Routes

| Method | Route | What you get |
|---|---|---|
| GET | `/api/public/documents/` | Every document with the revision in force today and the next scheduled ones. |
| GET | `/api/public/documents/{docId}/in-force/?on=YYYY-MM-DD` | Which revision applies on a date. Use it so a pilot never opens the wrong one during an overlap. |
| GET | `/api/public/documents/{docId}/manifest/` | All released revisions: id, number, label, effectiveDate, state, contentVersion, counts, previous revision, links to tree, changes and package. |
| GET | `/api/public/revisions/{id}/tree/` | Chapters → sections → topics with nodeId, number, title, pdfPage, and each topic’s blocks: [{nodeId, kind}]. Same as nodes.json. |
| GET | `/api/public/revisions/{id}/nodes/{nodeId}/` | One node by permanent ID: kind, number, title, its topic, PDF page, and the block’s content and text. |
| GET | `/api/public/resolve/?doc={docId}&node={nodeId}&on=YYYY-MM-DD` | A deep link resolved: the revision in force on the date, the node as above, and the Pilot DMS reader URL (section 8). |
| GET | `/api/review/changes/?doc={docId}&from={n}&to={m}` | The node-level change record between two released revisions (section 6). |
| GET | `/api/public/annotations/classify/?doc=&from=&to=&node=` | What to do with one annotation: unchanged, changed, moved, removed, not found, with a guidance sentence. |
| GET | `/api/public/events/?since=<ISO timestamp>` | Publish, schedule and in-force events since a moment (section 7). This feeds your alert. |
| GET | `/api/public/revisions/{id}/package.zip` | Everything for one revision in one file (section 4), for a file-based handoff or offline loading. |
| POST | `/api/public/ack/` with `{"revision": id}` | Tell Pilot DMS the app has the revision. It shows as Delivered on our side. Safe to repeat. Token only. |

Every route serves released revisions only. The id in a route is the integer from the
documents list, the manifest or an event.

## 4. The release package

One ZIP per released revision, named {docId}_Rev{n}.package.zip (bulletins:
{docId}_Issue{n}.package.zip). FM-S100 Rev 3 is about 9 MB and is the full-size manual for
your offline test: 1,193 topics, 1,083 PDF pages.

| File | Content |
|---|---|
| manifest.json | Identity, dates, state, counts, previous revision, file list. Same objects as the manifest route. |
| nodes.json | The tree with node IDs, numbers, titles, PDF pages and block IDs. Same as the tree route. |
| changes.json | The change record against the previous released revision. Absent for a document’s first release. |
| content.xml | The manual exactly as published, byte for byte (section 5). |
| rendition.pdf | The PDF, with a bookmark outline (chapter, section, topic). pdfPage in nodes.json is the 1-based page in this file. |

PDF-only documents (the two bulletins, BUL-26-01 and BUL-26-02) have contentFormat: "pdf": a manifest.json whose outline lists {title, page} entries, the PDF, and no
nodes.json, changes.json or content.xml. A link into a bulletin reaches a section through
the outline, not a node ID.

The package carries no checksums in version 1; it is served over HTTPS. Tell us if your
importer needs per-file hashes and we add them to the manifest.

## 5. The XML you receive

content.xml is the source file in namespace urn:sample:fltpub:1.0, the client’s
sample-fltpub.xsd. It is checked against that schema when it enters Pilot DMS and stored
unchanged, so it validates on your side with the same XSD. A file that fails the schema, has
a duplicate ID or a dangling cross-reference never becomes a revision.

```
manual (id = document ID, docType)
  meta: docId, title, docType, applicability, revision, revisionDate, effectiveDate,
        owner, changeSummary, classification
  chapter (id, number) › title
    section (id, number) › title
      topic (id, number) › title, then blocks in order:
        para | note | caution | warning (id)   text with inline <xref target="…">label</xref>
        list (id) › item*
        table (id) › row (header="true"?) › cell*
        checklist (id) › check (id) › challenge, response
        melItem (id, category A–D, installed, required) › remarks        MEL only
```

| Rule | Detail |
|---|---|
| IDs | {document key}-{letter}{digits}: c chapter, s section, t topic, p block and checklist item (fm100-c01, fm100-s001, fm100-t0043, fm100-p00673). Unique within a file, assigned at authoring, never reissued. The root manual id is the document ID. |
| Numbers | Only chapters, sections and topics carry number (01, 01.10, 01.10.1). It is positional and may change in every revision. |
| Cross-references | `<xref target="fm100-t0005">01.10.5 General Policy 5</xref>` points at a node by ID; the text inside is display only and may be stale. Render it as a link to the target ID. |
| Text | We collapse runs of whitespace to single spaces when we extract text. Do the same before comparing text with ours. |
| Derived for you | nodes.json is the tree we extracted from this XML, with block IDs and PDF pages, and the node route gives each block’s content in a structured shape (segments, items, rows, checks or MEL fields) plus plain text. Render from the XML or from the node route; both come from the same parse. |
| Production | This is the client’s prototype schema. The production authoring format (Oxygen XML Editor) is confirmed separately; the format version moves with it. |

## 6. The change record, and what to do with a pilot’s annotation

changes.json (and the changes route) lists topics as added, removed, moved (from/to
numbers), modified and renumbered, and blocks as added, removed, modified, all by ID.

How we decide, the client’s rules confirmed against their revision keys:

- Nodes are matched by ID, never by number or title.

- A topic is moved when its parent section changes; it may also be modified.

- A block is modified when its content changes. A cross-reference counts by its target ID,
  so a label that only shows a new number is not a change (labelOnly counts those).

- A topic is modified when a block of it was added, removed, reordered or modified, or its
  title or SSI marking changed.

- A topic is renumbered when nothing else about it changed. It is the same topic; nothing
  to flag.

- Lists, tables, checklists and MEL items are compared as structures, not as text.

| The annotated block is… | Do |
|---|---|
| in none of the lists | Carry the annotation forward silently. |
| in blocks.modified | Carry it forward and flag it for the pilot to review. |
| in a topic listed in topics.moved (not modified) | Follow it to the new location. The number changes; the ID does not. |
| in blocks.removed | Move it to an orphan list with the original text; the pilot keeps it as a note or discards it. |

The classify route answers the same question for one node. The client’s
revision-keys/annotation_test_cases_Rev1_to_Rev2.json gives one anchor block per case on
FM-S100 Rev 1 → Rev 2; both teams run those four.

## 7. The alert

Poll /api/public/events/?since=… with the last next value you received. Each event names
the document, the revision and its effective date, and links to the manifest and the package.

```json
{ "events": [
    { "id": "15:scheduled", "at": "2026-10-07T20:14:03Z", "type": "scheduled", "docId": "FOM", "revision": 13, "label": "Rev 13",
      "effectiveDate": "2026-11-15", "manifest": "/api/public/documents/FOM/manifest/", "package": "/api/public/revisions/15/package.zip" },
    { "id": "15:in_force", "at": "2026-11-15T06:00:00Z", "type": "in_force", "docId": "FOM", "revision": 13, "label": "Rev 13", "effectiveDate": "2026-11-15" }
  ], "next": "2026-11-15T06:00:00Z" }
```

- published means in force at once; scheduled means in force later, so the alert can say
  when; in_force arrives when a scheduled revision’s date comes.

- Events are oldest first. since defaults to 30 days ago. Events are derived from the
  released revisions, so re-reading a window is harmless and an event’s id is stable.

- Poll when the app starts and every few minutes while it is open. There is no rate limit.

- Polling is the committed path. A webhook that POSTs the same event JSON to a URL you
  register, signed with an HMAC-SHA256 X-Signature header over the body, is optional later.

## 8. Deep links

A deep link is a document ID plus a node ID, optionally with a date. Never a page number or a
topic number.

To resolve one in your app:

- Find the revision of docId in force today (or on the date) from the documents list, the
  manifest or the in-force route.

- Look up nodeId in that revision’s tree. A topic opens itself. A block ID opens the topic
  that holds it, scrolled to the block. A checklist item opens its checklist’s topic. A
  chapter or section opens its first topic.

- If the ID is not in that revision, check the change record: removed means say so and
  offer the previous revision; otherwise it may be new in a scheduled revision, so check that
  revision’s tree.

Or ask us: GET /api/public/resolve/?doc=FM-S100&node=fm100-p00673 returns the revision
(id, number, label, state, effectiveDate), the node as the node route gives it, and
url, the Pilot DMS reader address for the same place. The two failure messages are
No released revision of FM-S100 is in force on 2026-01-01. and Node fm100-t9999 is not in FM-S100 Rev 2. It may be new in a later revision or removed.

Into Pilot DMS: /doc/{docId}/node/{nodeId} on the Pilot DMS web app opens our reader at that
node, should the EFB ever link back to the DMS.

The client’s deep_link_samples.json has 7 links on FM-S100 Rev 2 with the expected number and
title; both teams run the same 7.

## 9. The demo we run together

Live:

- Team 1 publishes FOM Rev 13 on the Pilot DMS dashboard with effective date 15 Nov 2026.

- A scheduled event appears on the events route.

- Pilot EFB fetches the package (or reads the manifest, tree and changes routes).

- Pilot EFB shows Rev 13 as upcoming, keeps Rev 12 in force, and raises the alert.

- Pilot EFB calls POST /api/public/ack/.

- Pilot DMS shows the delivery.

File only, when the demo server is not reachable from your side:

- Team 1 publishes FOM Rev 13 and exports FOM_Rev13.package.zip (Download package on our
  Releases page, or our export command) and hands you the file.

- Pilot EFB imports it, reads state and effectiveDate from manifest.json, shows Rev 13
  as upcoming with Rev 12 in force, and raises the alert.

- Team 1 records the delivery for your consumer on our side, so Distribution shows Delivered.

Either way, both teams then check the four annotation cases on FM-S100 Rev 1 → Rev 2 and the
seven deep links on Rev 2.

## 10. Payload shapes at a glance

```
// GET /api/public/documents/
[ { "docId": "FM-S100", "title": "Sample Flight Manual - SAMPLE-100", "docType": "FM", "applicability": "SAMPLE-100", "contentFormat": "xml",
    "inForce": { "id": 11, "number": 2, "label": "Rev 2", "effectiveDate": "2026-07-15", "contentVersion": 1 },
    "upcoming": [ { "id": 12, "number": 3, "label": "Rev 3", "effectiveDate": "2026-12-01", "contentVersion": 1 } ] } ]

// manifest.json (one revision). The manifest route returns the same "document" object plus
// "revisions": [ this "revision" object + id + previousRevision + counts + links ] for every released revision.
{ "format": "pilot-dms-release/1",
  "document": { "docId": "FM-S100", "title": "Sample Flight Manual - SAMPLE-100", "docType": "FM", "applicability": "SAMPLE-100",
                "ownerDepartment": "Sample Flight Standards", "contentFormat": "xml" },
  "revision": { "number": 3, "label": "Rev 3", "revisionDate": "2026-11-02", "effectiveDate": "2026-12-01", "publishedAt": "2026-10-07T20:14:03Z",
                "state": "scheduled", "contentVersion": 1, "changeSummary": "Text updates and two new topics.",
                "classification": "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE" },
  "previousRevision": { "number": 2, "effectiveDate": "2026-07-15" },
  "counts": { "chapters": 19, "sections": 71, "topics": 1193, "blocks": 8563, "xrefs": 198, "pdfPages": 1083 },
  "files": { "nodes": "nodes.json", "changes": "changes.json", "content": "content.xml", "rendition": "rendition.pdf" },
  "source": { "system": "Pilot DMS", "revisionUrl": "/api/public/revisions/12/" } }

// nodes.json  /  GET /api/public/revisions/{id}/tree/
{ "format": "pilot-dms-release/1", "docId": "FM-S100", "revision": 3,
  "chapters": [ { "nodeId": "fm100-c01", "number": "01", "title": "Introduction", "pdfPage": 2,
    "sections": [ { "nodeId": "fm100-s001", "number": "01.10", "title": "Manual Organization", "pdfPage": 2,
      "topics": [ { "nodeId": "fm100-t1193", "number": "01.10.1", "title": "New Sample Topic: Engine Anti-Ice", "pdfPage": 2, "ssi": false,
        "blocks": [ { "nodeId": "fm100-p10029", "kind": "para" }, { "nodeId": "fm100-p10030", "kind": "para" } ] } ] } ] } ] }

// GET /api/public/revisions/{id}/nodes/fm100-p00673/
{ "kind": "para", "nodeId": "fm100-p00673", "number": "03.10.1", "title": "Briefing: Fuel Crossfeed",
  "topic": { "nodeId": "fm100-t0193", "number": "03.10.1", "title": "Briefing: Fuel Crossfeed" }, "pdfPage": 84,
  "block": { "kind": "para", "text": "…exactly as written…", "content": { "segments": [ { "text": "…" }, { "xref": "fm100-t0005", "label": "01.10.5 General Policy 5" } ] } } }

// changes.json  /  GET /api/review/changes/?doc=FM-S100&from=2&to=3
{ "format": "pilot-dms-release/1", "docId": "FM-S100", "fromRevision": 2, "toRevision": 3,
  "topics": { "added": [ { "id", "number", "title" } ], "removed": [ … ], "moved": [ { "id", "from", "to", "title" } ], "modified": [ … ], "renumbered": [ … ] },
  "blocks": { "added": [ "fm100-p10084" ], "removed": [ "fm100-p00158" ], "modified": [ "fm100-p00006" ] }, "labelOnly": 9 }

// GET /api/public/resolve/?doc=FM-S100&node=fm100-p00673
{ "revision": { "id": 11, "number": 2, "label": "Rev 2", "state": "in_force", "effectiveDate": "2026-07-15" },
  "node": { …as the node route… }, "url": "/library/FM-S100/rev/11?node=fm100-p00673" }
```

Block kind is one of para, note, caution, warning, list, table, checklist,
melItem. ssi marks a topic as sensitive security information; show the marking.
contentVersion changes only for a DMS-side marking such as SSI, never for text; when it
changes, fetch the tree again.

## 11. Errors

| Status | When | Body |
|---|---|---|
| 400 | A query value is malformed, for example on=2026-13-01 | A message that names the field and the expected form |
| 401 | No token, an unknown token, or a deactivated one | {"detail": "This token is not valid or has been deactivated."} |
| 403 | The wrong kind of credential: an authoring-tool token on a reading route, or a person’s session on ack | {"detail": "…"} saying which credential the route takes |
| 404 | A document, revision or node that is not released or does not exist. A draft or a revision in review looks exactly like one that does not exist. | {"detail": "Node fm100-t9999 is not in FM-S100 Rev 2."} |

## 12. Agreements

- Format version pilot-dms-release/1. Within version 1 changes are additive only: new fields
  may appear, existing fields keep their meaning.

- Changes to the format are agreed by the two technical leads, then written down, then built.

- Tell Team 1 what else your app needs and we add it to the spec before anyone codes it.

Open with the Pilot EFB team:

- Import, polling or both for the demonstration.

- Whether your app calls the API from a browser origin, and which.

- Any field you need, for example a per-topic plain-text excerpt for an on-device search
  index, or per-file checksums in the manifest.

Questions: Team 1 technical lead, Business Intelligence Group.
