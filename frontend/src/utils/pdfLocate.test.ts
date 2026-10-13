import { describe, expect, it } from "vitest";
import { locateText, needleFor, type TextRun } from "./pdfLocate";

function line(page: number, top: number, text: string): TextRun {
  return { page, top, left: 0, width: 100, height: 10, text };
}

describe("locateText", () => {
  const runs = [
    line(1, 10, "During preflight, the pilot monitoring should select the Fuel"),
    line(1, 22, "Crossfeed selector position if a discrepancy is observed."),
    line(1, 40, "The Probe Heat advisory is expected to read within range."),
    line(2, 10, "This text is fictional and exists only to give the prototype volume."),
    line(2, 30, "This text is fictional and exists only to give the prototype volume."),
  ];

  it("places a unique match across wrapped lines", () => {
    const result = locateText(
      runs,
      "During preflight, the pilot monitoring should select the Fuel Crossfeed selector position.",
    );
    expect(result).toEqual({ placed: true, boxes: [{ page: 1, top: 10, bottom: 32 }] });
  });

  it("spans every page the block covers", () => {
    const wrapped = [
      line(1, 50, "During climb, the first officer should verify the Probe Heat"),
      line(2, 5, "advisory before the next phase of flight."),
    ];
    expect(
      locateText(
        wrapped,
        "During climb, the first officer should verify the Probe Heat advisory before the next phase of flight.",
      ),
    ).toEqual({
      placed: true,
      boxes: [
        { page: 1, top: 50, bottom: 60 },
        { page: 2, top: 5, bottom: 15 },
      ],
    });
  });

  it("lengthens an ambiguous opening until it is unique", () => {
    const boilerplate = [
      line(1, 10, "This text is fictional and exists only to give the prototype volume."),
      line(1, 22, "The Window Heat status message is expected to read within range."),
      line(1, 40, "This text is fictional and exists only to give the prototype volume."),
      line(1, 52, "The Probe Heat advisory is expected to read within range."),
    ];
    expect(
      locateText(
        boilerplate,
        "This text is fictional and exists only to give the prototype volume. The Probe Heat advisory is expected to read within range.",
      ),
    ).toEqual({ placed: true, boxes: [{ page: 1, top: 40, bottom: 62 }] });
  });

  it("refuses a match that appears more than once", () => {
    expect(
      locateText(runs, "This text is fictional and exists only to give the prototype volume."),
    ).toEqual({ placed: false, reason: "ambiguous" });
  });

  it("reports text that is not on the pages", () => {
    expect(locateText(runs, "Nothing like this sentence is printed anywhere.")).toEqual({
      placed: false,
      reason: "not-found",
    });
  });

  it("matches whole words only", () => {
    expect(locateText([line(1, 0, "rangefinder is expected to read")], "range is expected to read")).toEqual({
      placed: false,
      reason: "not-found",
    });
  });

  it("needs at least three words to search", () => {
    expect(needleFor("Checked")).toBeUndefined();
  });

  it("searches table cells as running text", () => {
    expect(
      locateText(
        [line(1, 0, "Condition"), line(1, 0, "Sample value"), line(1, 0, "Remarks")],
        "Condition | Sample value | Remarks",
      ).placed,
    ).toBe(true);
  });
});
