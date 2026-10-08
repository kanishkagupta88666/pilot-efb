import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";
import { ContentBlocks } from "./components/ContentBlocks";
import {
  getTopic,
  type TopicContent,
} from "./data/mockData";

function renderApp(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("document library", () => {
  it("shows only the document and revision from the provisional sample", () => {
    renderApp();

    expect(
      screen.getByRole("heading", {
        name: "Sample Flight Manual - SAMPLE-100",
      }),
    ).toBeTruthy();
    expect(screen.getByText("FM-S100")).toBeTruthy();
    expect(screen.getByText("2026-07-01")).toBeTruthy();
    expect(screen.getByText("2026-07-15")).toBeTruthy();
    expect(screen.getByText("FM", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("2", { selector: "dd" })).toBeTruthy();
    expect(screen.queryByText("FM-S200")).toBeNull();
  });

  it("opens the selected revision in the reader", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("link", { name: "Open reader" }));

    expect(
      await screen.findByRole("heading", {
        name: "05.10.16 Autothrottle Crew Awareness",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to library" })).toBeTruthy();
    expect(screen.getByText("Revision date 2026-07-01")).toBeTruthy();
    expect(screen.getByText("Effective date 2026-07-15")).toBeTruthy();
  });
});

describe("reader", () => {
  it("renders and expands the source navigation hierarchy", () => {
    renderApp("/reader/FM-S100/2");

    const navigation = screen.getByLabelText("Document navigation");
    expect(within(navigation).getByText("05 Non-Normal Procedures")).toBeTruthy();
    expect(within(navigation).getByText("05.10 Air Systems")).toBeTruthy();
    expect(
      within(navigation).getByRole("button", {
        name: /05\.10\.16 Autothrottle Crew Awareness/,
      }),
    ).toBeTruthy();
  });

  it("renders topic blocks in source order and shows unavailable xrefs as text", () => {
    const { container } = renderApp("/reader/FM-S100/2");
    const sourceTopic = getTopic("FM-S100", 2, "fm100-t0340").topic;
    const blockElements = Array.from(
      container.querySelector(".topic-content")?.children ?? [],
    );

    expect(blockElements.map((element) => element.id)).toEqual(
      sourceTopic.blocks.map((block) => block.id),
    );
    expect(
      screen.getByText("11.20.1 Oxygen Distribution Crew Awareness"),
    ).toBeTruthy();
    expect(
      screen.getByText("Not available in this prototype."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /The Speedbrake Handle switch position that differs from the expected state/,
      ),
    ).toBeTruthy();

      const paragraph = container.querySelector("#fm100-p03214 p");
      const xref = sourceTopic.blocks[0];
      if (xref.type !== "para") {
        throw new Error("Expected first source block to be a paragraph.");
      }
      expect(paragraph?.textContent).toBe(
        xref.segments
          .map((segment) =>
            segment.type === "xref"
              ? `${segment.text} Not available in this prototype.`
              : segment.text,
          )
          .join(""),
      );
  });

  it("renders ordered list items as bullets", () => {
    const { container } = renderApp("/reader/FM-S100/2");
    const sourceList = getTopic("FM-S100", 2, "fm100-t0340").topic.blocks.find(
      (block) => block.type === "list",
    );

    if (sourceList?.type !== "list") {
      throw new Error("Expected source topic list.");
    }
    expect(
      Array.from(container.querySelectorAll(`#${sourceList.id} li`)).map(
        (item) => item.textContent,
      ),
    ).toEqual(sourceList.items);
  });

  it("renders the contract table with a header row in source order", () => {
    renderApp("/reader/FM-S100/2");
    fireEvent.click(screen.getByRole("button", { name: /Examples/ }));
    expect(screen.getAllByText("MOCK", { selector: ".mock-badge" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Table renderer example/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /18\.10\.12 Transponder Reset Guidance/ }),
    );

    const headers = screen.getAllByRole("columnheader");
    const sourceTable = getTopic("FM-S100", 2, "fm100-t1086").topic.blocks[0];
    if (sourceTable.type !== "table") {
      throw new Error("Expected mock topic table.");
    }
    expect(headers.map((header) => header.textContent)).toEqual([
      "Condition",
      "Sample value",
      "Remarks",
    ]);
    expect(
      Array.from(document.querySelectorAll("#fm100-p09258 tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map(
          (cell) => cell.textContent,
        ),
      ),
    ).toEqual(sourceTable.rows.map((row) => row.cells));
    expect(screen.getByText("MOCK — separate table example from the provisional contract.")).toBeTruthy();
  });

  it("renders checklist checks in source order with interactive controls", () => {
    renderApp("/reader/FM-S100/2");
    const checks = getTopic("FM-S100", 2, "fm100-t0340").topic.blocks.find(
      (block) => block.type === "checklist",
    );
    const checkboxes = screen.getAllByRole("checkbox");

    expect(checks?.type).toBe("checklist");
    if (checks?.type !== "checklist") {
      throw new Error("Expected source topic checklist.");
    }
    expect(checkboxes).toHaveLength(checks.checks.length);
    expect(
      checkboxes.map((checkbox) => checkbox.closest("li")?.id),
    ).toEqual(checks.checks.map((check) => check.id));

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0].getAttribute("checked")).toBeNull();
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it("scrolls to and highlights a requested checklist check", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const { container } = renderApp(
      "/reader/FM-S100/2?nodeId=fm100-p03219",
    );

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(container.querySelector("#fm100-p03219")?.className).toContain(
      "content-block--targeted",
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2250));
    });
    expect(
      container.querySelector("#fm100-p03219")?.className,
    ).not.toContain("content-block--targeted");
  });

  it("supports warning blocks without implying a severity colour", () => {
    const topic: TopicContent = {
      id: "warning-fixture",
      number: "test",
      title: "Warning fixture",
      chapterId: "test-chapter",
      sectionId: "test-section",
      blocks: [
        {
          type: "warning",
          id: "warning-block-fixture",
          segments: [{ type: "text", text: "Sample warning text." }],
        },
      ],
    };
    render(
      <MemoryRouter>
        <ContentBlocks
          completedChecks={{}}
          docId="FM-S100"
          onToggleCheck={() => undefined}
          revision={2}
          topic={topic}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Warning")).toBeTruthy();
    expect(screen.getByText("Sample warning text.")).toBeTruthy();
  });

  it("links cross-references only when their target exists in local data", () => {
    const topic: TopicContent = {
      id: "xref-fixture",
      number: "test",
      title: "Cross-reference fixture",
      chapterId: "test-chapter",
      sectionId: "test-section",
      blocks: [
        {
          type: "para",
          id: "xref-block-fixture",
          segments: [
            { type: "text", text: "Before " },
            {
              type: "xref",
              targetId: "fm100-t1086",
              text: "18.10.12 Transponder Reset Guidance",
            },
            { type: "text", text: " after." },
          ],
        },
      ],
    };
    render(
      <MemoryRouter>
        <ContentBlocks
          completedChecks={{}}
          docId="FM-S100"
          onToggleCheck={() => undefined}
          revision={2}
          topic={topic}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", {
        name: "18.10.12 Transponder Reset Guidance",
      }).getAttribute("href"),
    ).toBe("/reader/FM-S100/2?nodeId=fm100-t1086");
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
