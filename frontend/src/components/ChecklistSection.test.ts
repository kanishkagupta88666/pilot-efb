import { describe, expect, it } from "vitest";
import type { IndexedTopic, SearchIndexDocument } from "../types/api";
import { checklistManuals } from "./ChecklistSection";

function topic(id: string, number: string, sectionNumber: string, sectionTitle: string, types: string[]): IndexedTopic {
  return {
    id,
    number,
    title: `Topic ${number}`,
    sectionNumber,
    sectionTitle,
    blocks: types.map((type, index) => [`${id}-b${index}`, type, "text"]),
  };
}

function manual(docId: string, topics: IndexedTopic[]): SearchIndexDocument {
  return {
    docId,
    title: `${docId} manual`,
    docType: "FM",
    applicability: "ALL",
    category: "fleet",
    revision: 2,
    effectiveDate: "2026-07-15",
    topics,
  };
}

describe("checklistManuals", () => {
  it("groups checklist topics by section in manual order and links to the checklist block", () => {
    const [result] = checklistManuals([
      manual("FM-1", [
        topic("t1", "03.10.1", "03.10", "Preflight", ["para", "checklist"]),
        topic("t2", "03.10.2", "03.10", "Preflight", ["para"]),
        topic("t3", "03.20.1", "03.20", "Taxi", ["checklist"]),
        topic("t4", "03.10.3", "03.10", "Preflight", ["checklist"]),
      ]),
    ]);

    expect(result.phases.map((phase) => phase.title)).toEqual(["Preflight", "Taxi"]);
    expect(result.phases[0].checklists).toEqual([
      { id: "t1-b1", number: "03.10.1", title: "Topic 03.10.1" },
      { id: "t4-b0", number: "03.10.3", title: "Topic 03.10.3" },
    ]);
  });

  it("keeps sections with the same title apart and leaves out manuals without checklists", () => {
    const result = checklistManuals([
      manual("FOM", [topic("t1", "01.10.1", "01.10", "General", ["para"])]),
      manual("FM-2", [
        topic("t1", "03.10.1", "03.10", "Checks", ["checklist"]),
        topic("t2", "05.10.1", "05.10", "Checks", ["checklist"]),
      ]),
    ]);

    expect(result.map((entry) => entry.docId)).toEqual(["FM-2"]);
    expect(result[0].phases.map((phase) => phase.number)).toEqual(["03.10", "05.10"]);
  });
});
