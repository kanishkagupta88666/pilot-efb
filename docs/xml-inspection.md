# FM-S100 Rev 2 XML inspection

This report describes the synthetic dataset in `sample-data/`; it does not
implement XML ingestion or establish operational meaning for the content.
Inspection used `lxml` with external entity/network access disabled and a PDF
outline reader. The 5.2 MB XML and 3.1 MB PDF were inspected selectively.

## 1. XML namespace and root element

`sample-data/xml/FM-S100_Rev2.xml` has a `manual` root in
`urn:sample:fltpub:1.0` (the XML uses this as its default namespace). Its
attributes are `id="FM-S100"` and `docType="FM"`. The root `id` is the document
identity; unlike chapter, section, topic, and block IDs, the XSD types this
attribute as `xs:string`.

The instance was successfully validated against
`sample-data/schema/sample-fltpub.xsd` with lxml.

## 2. Metadata

There is one `meta` element, immediately inside `manual`, before the chapters.
Its child elements, in source/schema order, are:

| Field | FM-S100 Rev 2 value |
|---|---|
| `docId` | `FM-S100` |
| `title` | `Sample Flight Manual - SAMPLE-100` |
| `docType` | `FM` |
| `applicability` | `SAMPLE-100` |
| `revision` | `2` |
| `revisionDate` | `2026-07-01` |
| `effectiveDate` | `2026-07-15` |
| `owner` | `Sample Flight Standards` |
| `changeSummary` | `Reorganization revision. Topics relocated between sections, five topics removed, text updates and new topics.` |
| `classification` | `SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE` |

These are child elements containing text, not metadata attributes. `meta` has no
`id` in this instance.

## 3. Hierarchy

The observed structure is:

```text
manual
├── meta
└── chapter (19)
    └── section (71 total)
        └── topic (1,193 total)
            └── ordered content blocks
```

`meta` occurs once as a direct child of `manual`; it does not occur inside
chapters, sections, or topics. Each chapter has its title followed by sections;
each section has its title followed by topics; each topic has its title followed
by content blocks. Example path:

```text
manual FM-S100
└── chapter fm100-c01, number 01, "Introduction"
    └── section fm100-s001, number 01.10, "Manual Organization"
        └── topic fm100-t1193, number 01.10.1,
            "New Sample Topic: Engine Anti-Ice"
```

## 4. Block types

The XSD permits `para`, `note`, `caution`, `warning`, `list`, `table`,
`checklist`, and `melItem` as topic blocks. Ignoring `melItem` as requested, the
block types actually present in FM-S100 Rev 2 are:

| Block type | Count | Verified example |
|---|---:|---|
| `para` | 4,289 | `id="fm100-p10029"`; text-only paragraph |
| `note` | 1,032 | `id="fm100-p00002"` |
| `caution` | 1,031 | `id="fm100-p00005"` |
| `list` | 1,045 | `id="fm100-p10032"`; contains `item` children |
| `table` | 1,011 | `id="fm100-p10033"`; rows contain cells |
| `checklist` | 159 | `id="fm100-p00700"`; contains `check` children |

There are **no** `warning` blocks and no `melItem` blocks in this revision.
`check` is a child within a checklist, not a separate topic-level block; there
are 1,474 `check` elements. `para`, `note`, and `caution` use the same mixed-text
structure, which can include inline `xref` elements. A table's first row in the
example has `header="true"`; later rows need not have a `header` attribute.

## 5. Permanent IDs

There are 11,325 `id` attributes in total, with no duplicate ID values in the
FM-S100 Rev 2 XML. ID-bearing element counts are:

| Element | Count |
|---|---:|
| `manual` | 1 |
| `chapter` | 19 |
| `section` | 71 |
| `topic` | 1,193 |
| `para` | 4,289 |
| `note` | 1,032 |
| `caution` | 1,031 |
| `list` | 1,045 |
| `table` | 1,011 |
| `checklist` | 159 |
| `check` | 1,474 |

Three actual examples are `fm100-c01`, `fm100-t1193`, and `fm100-p00673`.
Chapter, section, and topic IDs follow forms such as `fm100-c01`,
`fm100-s001`, and `fm100-t1193`; content block and checklist-item IDs use the
`fm100-p` prefix, for example `fm100-p00689`. The supplied XSD's `NodeId` type
restricts these node IDs to lowercase alphanumeric prefix, hyphen, one of
`c/s/t/p`, and digits (with XML `xs:ID` constraints). The document root ID is
`FM-S100` and is separately typed as a string. Preserve source IDs exactly;
they are identities, not values to derive from `number`.

Elements such as `item`, `row`, `cell`, `title`, `meta`, and `xref` do not carry
an `id` in this document.

## 6. Numbers and titles

Every chapter (19), section (71), and topic (1,193) has a `number` **attribute**.
The observed numbers are positional, for example chapter `01`, section `01.10`,
and topic `01.10.1`. These elements have a `title` **child element** containing
the title text. `meta` also has a `title` child, but no `number`. The observed
blocks do not have `number` attributes or title children. Do not substitute a
number for an ID.

## 7. Cross-references

There are 197 `xref` elements, with 178 distinct `target` values. An `xref` is
inline within a `para`; its visible link text is the element's text, and its
target is the required `target` attribute. For example, paragraph
`fm100-p00036` contains:

```xml
<xref target="fm100-t0649">09.10.6 Flap Position Indication Overview</xref>
```

The `target` is the permanent topic ID, not the displayed topic number. All 178
distinct xref targets resolve to IDs in FM-S100 Rev 2. Paragraph text before,
inside, and after an `xref` must remain in order.

## 8. Checklists

Each of the 159 `checklist` elements contains one or more `check` children.
Each `check` has its own required `id` and contains `challenge` followed by
`response`. For example, checklist `fm100-p00700` begins with check
`fm100-p00689`, whose challenge is `Cabin Pressure Controller` and response is
`Armed`. A `check` ID is therefore addressable content and should not be lost
when representing a checklist.

## 9. Manifest

`sample-data/manifest.json` has root fields `generated` and `documents`.
`generated` is `2026-09-28`; `documents` contains eight entries. Each document
entry has these fields:

`docId`, `title`, `docType`, `applicability`, `revision`, `revisionDate`,
`effectiveDate`, `owner`, `changeSummary`, `xml`, `pdf`, `pdfPages`, and
`topics`.

For FM-S100 Rev 2 the entry maps `docId` `FM-S100`, `revision` `2`,
`revisionDate` `2026-07-01`, `effectiveDate` `2026-07-15`, and relative XML path
`xml/FM-S100_Rev2.xml`; its PDF path is `pdf/FM-S100_Rev2.pdf`, `pdfPages` is
1,080, and `topics` is 1,193. The manifest's `docId` is also the XML root and
metadata document ID in this instance. All manifest XML and PDF paths point to
existing files. FM-S100 Rev 2 is current according to the dataset README;
Rev 3 is dated effective 2026-12-01.

## 10. Deep-link samples

`sample-data/deep_link_samples.json` has a `note` and a `links` array. Each link
contains `docId`, `nodeId`, `expectedNumber`, and `expectedTitle`. All seven
entries use `docId="FM-S100"`; all seven `nodeId` values exist in the Rev 2 XML.
None is identified as belonging to another document.

| Target ID | Expected number | Expected title | Rev 2 result |
|---|---|---|---|
| `fm100-t1193` | `01.10.1` | `New Sample Topic: Engine Anti-Ice` | Topic; number and title match |
| `fm100-t0098` | `03.10.2` | `Flow: Wing Anti-Ice` | Topic; number and title match |
| `fm100-t0196` | `03.50.5` | `Checklist: Speedbrake Handle` | Topic; number and title match |
| `fm100-t0294` | `04.20.20` | `Checklist: Standby Instruments` | Topic; number and title match |
| `fm100-t0391` | `05.40.7` | `Hydraulic System B Overview` | Topic; number and title match |
| `fm100-t0488` | `06.10.5` | `Landing Gear Indication Overview` | Topic; number and title match |
| `fm100-p00673` | `03.10.1` | `Paragraph-level target inside a topic` | Paragraph inside topic `fm100-t0097`, `03.10.1`, “Briefing: Fuel Crossfeed” |

The paragraph-level sample's `expectedTitle` is a fixture description: the
target paragraph itself has no `title`; its containing topic has the stated
number and a different title. This is a meaningful distinction for consumers
that must resolve paragraph IDs while displaying topic context.

The six topic IDs and paragraph ID in the table also occur in FM-S100 Rev 0,
Rev 1, and Rev 3. `fm100-t1193` occurs in Rev 1, Rev 2, and Rev 3, but not Rev 0.
These fixtures are all scoped to FM-S100, and ID presence in a revision should
not be confused with that node's revision-specific number or content.

## 11. PDF outline and XML ID mapping

`sample-data/pdf/FM-S100_Rev2.pdf` has 1,080 pages and 1,283 outline entries:
19 chapter-level, 71 section-level, and 1,193 topic-level. The outline titles
contain displayed numbers and titles (for example, `03.10.2 Flow: Wing
Anti-Ice`), and each entry has a page destination.

I checked the catalog's `/Dests` entry and `/Names` tree, the destination
fields/actions on all outline entries, link annotations on all pages, document
metadata, extracted page text, and decoded strings in reachable PDF objects.
There is no catalog `/Dests` entry or `/Names` tree, and the PDF has zero named
destinations. Its 1,283 outline entries have titles and page destinations,
but no `/Dest` name or action carrying an XML node ID. The document has zero
link annotations. Neither the document metadata nor the 4,156,694 characters
of extracted page text contain `fm100-t1193`, `fm100-p00673`, or any
`fm100-[cstp]...` node-ID token. Those two exact strings also do not occur in
the raw PDF bytes or the scanned decoded PDF object strings.

The manifest records XML/PDF file paths, revision metadata, page counts, and
topic counts, but no ID-to-PDF destinations. The revision-key JSON files
record topic/block IDs alongside revision changes and, for moved topics, old
and new numbers; they do not contain PDF pages or destinations. For example,
the revision key records topic `fm100-t0191` moving from `03.50.1` to
`18.20.15`.

The only observed link between XML and this PDF outline is the displayed
number/title text: `fm100-t0098` has number `03.10.2` and title `Flow: Wing
Anti-Ice`, which matches an outline label. This is **not** an ID mapping.
Numbers are positional and can change when content moves; the revision keys
provide a real example of such a change. Relying on number/title matching as
identity can therefore resolve to the wrong or no node after revisions.
Permanent-ID-to-PDF mapping **cannot be verified from the supplied files**.
The sample-data README's claim that every outline entry is keyed to the XML
ID is not supported by the inspected PDF, manifest, or revision keys.

No mapping is created by this report. A future design could require a
publisher-supplied ID-to-PDF-destination manifest or add explicit ID-bearing
PDF destinations during PDF production, then validate those references
against the XML IDs. These are possible approaches only; neither is present
or verified in the current dataset.

## 12. XSD constraints

The schema targets `urn:sample:fltpub:1.0` and sets
`elementFormDefault="qualified"`, so instance elements must use that namespace.
The XML's default namespace satisfies this requirement.

- `manual` requires `id` and `docType` string attributes; its child sequence is
  one `meta`, then one or more `chapter` elements.
- `meta` requires, in order: `docId`, `title`, `docType`, `applicability`,
  `revision`, `revisionDate`, `effectiveDate`, `owner`, `changeSummary`, and
  `classification`. Its `docType` is restricted to `FM`, `FOM`, `WOM`, or
  `MEL`; revision is a non-negative integer, and the date fields use `xs:date`.
- Each `chapter` requires an `id` of type `NodeId` and a `number` string
  attribute; its sequence is `title`, then one or more `section` elements.
  Each `section` similarly requires `id` and `number`, then `title` followed
  by one or more `topic` elements. Each `topic` requires `id` and `number`,
  then `title` followed by one or more allowed block choices.
- `para`, `note`, `caution`, and `warning` share a mixed-content type with a
  required `NodeId` `id` and zero or more `xref` children. `xref` requires a
  `target` of type `xs:IDREF`.
- `list` requires an `id` and one or more `item` children. `table` requires an
  `id`, one or more rows, and one or more cells per row; row `header` is an
  optional boolean.
- `checklist` requires an `id` and one or more checks. Each `check` requires an
  `id`, then `challenge` followed by `response`.
- The schema also permits `melItem` with required `id` and `remarks`, and
  optional `category`, `installed`, and `required` attributes. `category`, when
  present, is restricted to A-D.
- `NodeId` restricts values using
  `[a-z0-9]+-[cstp][0-9]+|[A-Z0-9\-]+` on `xs:ID`. In plain terms, XML Schema
  treats each such node ID as a document-wide identifier: two `xs:ID` values
  in the same XML document cannot be equal, and an `xref/@target` typed as
  `xs:IDREF` must refer to an `xs:ID` value in that document. This is what the
  schema enforces about uniqueness and references; the observed node IDs are
  unique and all observed xref targets resolve.
- The `manual/@id` attribute is typed only as `xs:string`, not `xs:ID`, so it
  is not included in that uniqueness/reference mechanism and cannot be the
  guaranteed target of an `xs:IDREF`. The schema does not enforce that an ID
  stays the same across separate revisions, that root `id` equals `meta/docId`,
  or that any ID maps to a PDF destination. The no-change-across-revisions
  policy is a dataset/project rule, not an XSD constraint.

The XSD constrains element sequence and field types but does not assert that the
root `docType` equals `meta/docType`, or that the root `id` equals `meta/docId`.
Those pairs agree in FM-S100 Rev 2, but equality is not expressed by this XSD.

## 13. Dataset counts

| Item | FM-S100 Rev 2 count |
|---|---:|
| Chapters | 19 |
| Sections | 71 |
| Topics | 1,193 |
| `para` | 4,289 |
| `note` | 1,032 |
| `caution` | 1,031 |
| `warning` | 0 |
| `list` | 1,045 |
| `table` | 1,011 |
| `checklist` | 159 |
| `check` (nested checklist items) | 1,474 |
| `xref` | 197 |
| PDF outline entries | 1,283 |

## 14. README consistency

The listed FM-S100 Rev 0-3 XML and PDF files exist and correspond to the
manifest; the manifest's eight XML/PDF references also exist. The README's
approximate FM-S100 page count (“~1,075 each”) is not the exact count for each
revision: the manifest reports 1,073, 1,080, 1,080, and 1,083 pages, and the
inspected Rev 2 PDF has 1,080 pages.

More importantly, the README says that each PDF outline entry is keyed to the
same ID as XML. In FM-S100 Rev 2, bookmark titles carry number/title labels and
destinations carry page references, but no XML IDs or named destinations were
found. The claimed permanent-ID mapping could not be verified and should not
be treated as established by this PDF.

The README describes block types permitted by the set/schema. The XSD defines
`warning` as a `Text` block choice, but `warning` occurs zero times not only in
FM-S100 Rev 2: a scan of every XML file in `sample-data/xml/` found zero
warning elements in FM-S100 Revs 0, 1, 2, and 3, FM-S200 Rev 4, FOM Rev 12,
WOM Rev 7, and MEL-S100 Rev 9. `melItem` is also allowed by the schema but is
outside this cycle. The README's hierarchy and statement that chapters,
sections, topics, and blocks have IDs are consistent with the inspected
revision.

## 15. Implementation considerations

- Preserve the namespace, source order, all metadata, exact IDs, and mixed text
  around inline xrefs. Keep `id` separate from positional `number`, and retain
  `title` as display text.
- A future normalized representation and PostgreSQL schema should distinguish
  document identity, revision/effective-date metadata, stable node identity,
  and revision-specific parent, order/number, title, and content. It must also
  preserve block order and kind, table row/cell order and header flags,
  checklist/check IDs and challenge-response pairs, plus xref source and target
  IDs. Do not infer stable identity from a number, page, or title.
- A React Reader displaying one topic at a time will need its containing
  chapter/section context and the topic's number/title, then ordered blocks
  with their appropriate rendering, inline xref navigation, and checklist
  challenge/response. It should navigate by original node ID and clearly
  distinguish current versus upcoming revision effective dates.
- PDF navigation needs a separately supplied and verified mapping from
  permanent XML IDs to PDF destinations if ID-based deep links are required.
  The current PDF links outline entries only by positional number/title labels
  and page destinations; matching numbers/titles is not a permanent-ID
  guarantee and risks breaking or misdirecting links after renumbering.

## 16. Open questions

- Where should the authoritative permanent-ID-to-PDF destination mapping come
  from? It is absent from PDF outline destinations, named destinations, link
  annotations, metadata, page text, the manifest, and revision keys, despite
  the dataset README's statement.
- Should the paragraph-level deep-link fixture's `expectedTitle` be understood
  as a descriptive label, or should it specify the containing topic title?
  The paragraph has no title of its own.
- Should ingestion separately reject mismatched root `id`/`docType` and
  `meta/docId`/`docType` values? The current XSD does not express those
  equality constraints.
- The schema allows `warning`, but none occurs in any supplied XML document.
  Its intended presentation has not been evidenced in this dataset.
