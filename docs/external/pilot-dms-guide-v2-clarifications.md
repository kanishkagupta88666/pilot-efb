# Pilot DMS guide v2: clarifications and agreements

This file records what Team 1 (Pilot DMS) confirmed after sending
[the integration guide, version 2](pilot-dms-integration-guide-v2.md). Read the two together.
Where they differ, this file is the later statement.

- **Source:** the Teams thread between Team 1 and the Pilot EFB team, in the
  aero-solutions-combined-team channel. Team 1's messages were written by Manojkumar Mohankumar.
- **Dates:** the export of the thread shows times but no dates, so none are recorded here.
- **Scope:** only statements made in that thread. Nothing here is inferred. Points the thread
  leaves open are listed under [Not specified](#not-specified).

## Corrections to the guide

### `fm100-p00673` belongs to `fm100-t0097`, not `fm100-t0193`

Section 10 of the guide shows the node route for `fm100-p00673` with
`"topic": { "nodeId": "fm100-t0193", ... }`. That is wrong.

- **Team 1 confirmed:** `fm100-p00673` sits in topic `fm100-t0097` in Rev 1, 2 and 3, and
  `fm100-t0193` is a different topic. They said they have corrected it on their side.
- **Checked against this repository's sample data:** in `sample-data/xml/FM-S100_Rev0.xml` to
  `FM-S100_Rev3.xml`, `fm100-p00673` is inside `fm100-t0097` ("Briefing: Fuel Crossfeed",
  number 03.10.1). `fm100-t0193` is "Checklist: Autopilot Channel A".
- **Status of our copy:** the saved guide is kept as received and still shows `fm100-t0193`.
  A corrected copy of the guide has not been received.

## Clarifications from Team 1

### Manifest `state` is the state at export time

The `state` in a package's `manifest.json` is the state when the package was exported. It
must be recomputed from `effectiveDate` on the Pilot EFB side and not trusted as stored.

This qualifies section 9 of the guide, whose file-only demo says Pilot EFB "reads state and
effectiveDate from manifest.json".

### FOM Rev 13 has no PDF rendition

- FOM Rev 13 is a test revision that Team 1 authored from Rev 12.
- It has no PDF rendition. Its package carries the XML and JSON only, with no rendition file
  and null page numbers.
- It is the revision published during the demo, so its package comes out of that publish.
  Team 1 will send it earlier for import testing if asked.

An importer therefore cannot assume every XML package contains `rendition.pdf` or that
`pdfPage` is a number.

### Per-file checksums will be added

Team 1 will add a SHA-256 for each file in the manifest. It is an additive field, so nothing
changes for Pilot EFB until it chooses to use it.

### Markings

- The SSI flag is on every topic in `nodes.json`.
- The classification string is in the manifest, with the same text as in the XML.

## Agreements

| Topic | Agreed |
|---|---|
| Handoff method | Pilot EFB starts with ZIP package import, so the demo does not depend on the server. Team 1 confirmed the file-only demo is built for this |
| API access later | When Pilot EFB is ready, Team 1 issues one token for the Django backend. Polling the events feed is the only addition needed for the revision alert |
| Browser access | Not needed. The Pilot EFB frontend talks to its own Django backend, so Team 1 sets up nothing for browser origins |
| Revision states | `scheduled`, `in_force`, `superseded`, as in the guide |
| Time zone | America/Chicago for effective dates |
| Deep links | By permanent node ID |
| Annotations | Pilot EFB uses Team 1's change records and classification route and does not compute differences itself. Team 1: "one engine and one answer" |
| Markings | Pilot EFB preserves and shows the SSI marking and the document classification |
| Delivery in the file-based demo | Team 1 marks the package as delivered on its side |

## Packages Team 1 said it will send

| Package | Why |
|---|---|
| FM-S100 Rev 1 | The four annotation test cases are defined on Rev 1 to Rev 2 |
| FM-S100 Rev 2 | Requested by Pilot EFB for change-record and annotation testing |
| FM-S100 Rev 3 | Requested by Pilot EFB for change-record and annotation testing |
| FOM Rev 12 | The revision that stays in force while Rev 13 is upcoming |
| FOM Rev 13 | Produced by the publish during the demo; earlier on request |

Team 1 said it would send the set "this week". No package is stored in this repository.

## Not specified

The thread does not settle these points. Do not assume an answer.

- The name and shape of the checksum field in the manifest.
- How a missing rendition appears in `manifest.json`: whether the `rendition` entry under
  `files` is absent or null, and what `counts.pdfPages` holds.
- Whether a corrected guide document will be reissued, and under what version.
- The three items the guide lists as open in section 12. The thread answers the first two
  (import first, then polling; no browser origin). The third, extra fields, is answered only
  for checksums.
