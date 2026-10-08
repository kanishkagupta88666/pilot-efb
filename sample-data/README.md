# Synthetic Sample Manual Set

Prepared by Aero Solutions Pro LLC for the University of Illinois BIG prototype engagement. September 2026.

## Read this first

Every document in this set is **entirely fictional**. Fleet designators, stations, systems values, procedures and wording are invented to give the prototype realistic structure and volume. Nothing here is derived from any operator's manuals, and none of it may be used for any operational purpose. Every XML file and every PDF page is marked accordingly.

This set is the content boundary for the engagement. No real operational documents will be shared.

## Contents

| Document | Type | Applicability | Revisions | PDF pages |
|---|---|---|---|---|
| FM-S100 Sample Flight Manual | Fleet manual (large) | SAMPLE-100 | Rev 0, 1, 2, 3 | ~1,075 each |
| FM-S200 Sample Flight Manual | Fleet manual | SAMPLE-200 | Rev 4 | 278 |
| FOM Sample Flight Operations Manual | Master document | ALL | Rev 12 | 308 |
| WOM Sample Worldwide Operations Manual | Master document (40 fictional stations) | ALL | Rev 7 | 159 |
| MEL-S100 Sample Minimum Equipment List | Fleet document | SAMPLE-100 | Rev 9 | 50 |
| Bulletin 26-01 and 26-02 | Small supporting documents, **PDF only** | ALL | n/a | 5 and 9 |

```
xml/              XML source for every document and revision (source of truth)
pdf/              PDF rendition of every XML file, with a bookmark outline
pdf-only/         Small documents with no XML source, with a bookmark outline
schema/           sample-fltpub.xsd; every XML file validates against it
revision-keys/    Expected differences between FM-S100 revisions, plus annotation test cases
manifest.json     Metadata for every document: ID, type, applicability, revision, dates, owner, file paths
deep_link_samples.json   Sample inbound deep-link targets
```

## Structure and node IDs

`manual > meta > chapter > section > topic > blocks`. Blocks are `para`, `note`, `caution`, `warning`, `list`, `table`, `checklist` (with `check` challenge/response items) and, in the MEL, `melItem`.

Every chapter, section, topic and block has an `id`. Chapters, sections and topics also have a `number`. The rule that matters for both teams:

- **`id` is permanent.** It never changes across revisions, including when a topic moves to a different section.
- **`number` is positional.** It changes whenever content is added, removed or moved around it.

Deep links, annotations and bookmarks should anchor to `id`, never to `number` or page. Some paragraphs contain an `xref` to another topic's `id` for testing in-document links.

## PDF navigation

Page-level linking is not sufficient for PDFs. A link into a PDF should reach at least the chapter and subsection, and ideally the exact text.

- Every PDF rendition carries a bookmark outline (chapter, section, topic). Each outline entry is keyed to the same `id` used in the XML, so a node ID can be resolved to a location in the PDF.
- The PDF-only bulletins have a section-level outline and no XML. They are the test case for reaching a section, and then specific text, without structured source.

## Revision testing (FM-S100)

| Transition | Added topics | Removed topics | Moved topics | Modified topics |
|---|---|---|---|---|
| Rev 0 to Rev 1 | 6 | 0 | 0 | 40 |
| Rev 1 to Rev 2 | 4 | 5 | 8 | 25 |
| Rev 2 to Rev 3 | 2 | 2 | 2 | 11 |

- **Rev 2 is current** (effective 2026-07-15).
- **Rev 3 is approved but not yet effective** (effective 2026-12-01). Use it to test the overlap period, when a current and an upcoming revision are both available. Today pilots sometimes open the wrong one during that overlap, so the effective revision must be unmistakable.
- `revision-keys/FM-S100_RevX_to_RevY.json` lists the expected added, removed, moved and modified topics and blocks for each transition. Team 1 can check its reconciliation output against these keys.
- `revision-keys/annotation_test_cases_Rev1_to_Rev2.json` gives one anchor node for each annotation case (unchanged, changed, moved, removed) and the expected behavior. Team 2 can place an annotation on each in Rev 1, publish Rev 2, and confirm the result.

## Notes

- The real library has roughly five to six fleets with one to two large manuals each, plus two to three master documents and smaller documents of about 30 pages or fewer. This set models that shape at a smaller count (two fleets).
- The schema is simplified for prototype use. It is not the production authoring schema. The production format will be confirmed separately, including how content arrives from Oxygen XML Editor.
- The XSD can be loaded into Oxygen or any XML editor to validate edits or author additional test revisions.
- If additional revisions, smaller documents or other fleets would help testing, request them and they will be added in the same format.
