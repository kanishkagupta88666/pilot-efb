import { describe, expect, it } from "vitest";
import type { SearchIndexDocument } from "../types/api";
import { prepareDocument, searchLocal, snippet } from "./searchIndex";

// Same fixture and expectations as backend/documents/test_search.py, so online
// and offline search rank results identically.
function fixture(docId = "X", applicability = "SAMPLE-1", docType = "FM"): SearchIndexDocument {
  return {
    docId,
    title: docId,
    docType,
    applicability,
    category: applicability === "ALL" ? "master" : "fleet",
    revision: 1,
    effectiveDate: "2026-01-01",
    topics: [
      {
        id: "x-t1",
        number: "01.10.1",
        title: "Engine Anti-Ice",
        sectionNumber: "01.10",
        sectionTitle: "Section",
        blocks: [["x-p1", "para", "Set the engine anti-ice switch ON before descent."]],
      },
      {
        id: "x-t2",
        number: "01.10.2",
        title: "Hydraulic System A",
        sectionNumber: "01.10",
        sectionTitle: "Section",
        blocks: [
          ["x-p2", "para", "Hydraulic pressure is checked during preflight. Engine anti-ice is not required."],
          ["x-p3", "note", "Hydraulic quantity is shown on the lower display."],
        ],
      },
    ],
  };
}

const CASES: [string, [string, string, number, number][]][] = [
  ["engine anti-ice", [["x-t1", "x-p1", 20, 2], ["x-t2", "x-p2", 11, 1]]],
  ["hydraul", [["x-t2", "x-p2", 4, 3]]],
  ["anti engine", [["x-t1", "x-p1", 10, 2], ["x-t2", "x-p2", 4, 1]]],
  ["descent zzz", []],
  ["system a", [["x-t2", "x-t2", 13, 3]]],
];

describe("searchLocal", () => {
  it.each(CASES)("ranks %s like the API", (query, expected) => {
    const result = searchLocal(query, [prepareDocument(fixture())]);
    expect(result.results.map((r) => [r.topicId, r.nodeId, r.score, r.matchCount])).toEqual(expected);
  });

  it("keeps master documents under a fleet filter", () => {
    const documents = [
      prepareDocument(fixture("FLEET-1", "SAMPLE-1")),
      prepareDocument(fixture("FLEET-2", "SAMPLE-2")),
      prepareDocument(fixture("MASTER", "ALL", "FOM")),
    ];
    expect(Object.keys(searchLocal("engine", documents, { fleet: "SAMPLE-1" }).byDocument).sort()).toEqual([
      "FLEET-1",
      "MASTER",
    ]);
  });

  it("keeps supplemental documents for all fleets under a fleet filter, like the API", () => {
    const bulletin = { ...fixture("BULLETIN", "ALL", "BULLETIN"), category: "supplemental" as const };
    const documents = [prepareDocument(fixture("FLEET-2", "SAMPLE-2")), prepareDocument(bulletin)];
    expect(Object.keys(searchLocal("engine", documents, { fleet: "SAMPLE-1" }).byDocument)).toEqual(["BULLETIN"]);
    expect(Object.keys(searchLocal("engine", documents, { categories: ["supplemental"] }).byDocument)).toEqual([
      "BULLETIN",
    ]);
  });

  it("filters by document type and category", () => {
    const documents = [prepareDocument(fixture("A", "SAMPLE-1", "FM")), prepareDocument(fixture("B", "ALL", "FOM"))];
    expect(Object.keys(searchLocal("engine", documents, { docTypes: ["FOM"] }).byDocument)).toEqual(["B"]);
    expect(Object.keys(searchLocal("engine", documents, { categories: ["fleet"] }).byDocument)).toEqual(["A"]);
  });
});

describe("content filter", () => {
  it("keeps only the filtered block types, like the API", () => {
    const document = fixture();
    document.topics[1].blocks.push(["x-p4", "caution", "Hydraulic pump overheat."]);
    const prepared = [prepareDocument(document)];
    expect(
      searchLocal("hydraulic", prepared, { contentTypes: ["warnings"] }).results.map((r) => [r.nodeId, r.nodeType]),
    ).toEqual([["x-p4", "caution"]]);
    expect(searchLocal("engine", prepared, { contentTypes: ["procedures"] }).total).toBe(0);
    // The topic title says "System A", but the caution's own text does not.
    expect(searchLocal("system", prepared, { contentTypes: ["warnings"] }).total).toBe(0);
  });
});

// Same cases as SNIPPET_CASES in backend/documents/test_search.py.
const SNIPPET_CASES: [string, string[], string][] = [
  [
    "Set the switch ON. Engine anti-ice is required in icing. Check the light.",
    ["anti"],
    "Engine anti-ice is required in icing.",
  ],
  ["Engine anti-ice is required", ["engine"], "Engine anti-ice is required"],
  [
    "Condition | Value\nWindow Heat indication | 4 units\nProbe Heat | 2 units",
    ["window"],
    "Window Heat indication | 4 units",
  ],
];

describe("snippet", () => {
  it.each(SNIPPET_CASES)("takes the matching sentence of %s", (text, terms, expected) => {
    expect(snippet(text, terms)).toBe(expected);
  });

  it("starts near the first match, like the API", () => {
    const text = `${Array(40).fill("filler").join(" ")} the transponder is tested here ${Array(60).fill("tail").join(" ")}`;
    const excerpt = snippet(text, ["transponder"]);
    expect(excerpt.startsWith("… ")).toBe(true);
    expect(excerpt.endsWith(" …")).toBe(true);
    expect(excerpt).toContain("transponder");
  });
});
