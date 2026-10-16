import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiErrorState, EmptyState, LoadingState } from "./RequestStates";
import { RevisionAlert } from "./RevisionAlert";
import { RevisionSelector } from "./RevisionSelector";
import { getDocumentLibrary } from "../data/mockData";
import { DATA_SOURCE } from "../config/dataSource";
import type { DocumentRevision } from "../types/api";
import { AppRoutes } from "../App";

const baseRevision = getDocumentLibrary()[0].availableRevisions[0];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function withStatus(
  status: DocumentRevision["status"],
  revision: number,
): DocumentRevision {
  return { ...baseRevision, status, revision };
}

describe("frontend integration preparation", () => {
  it("defaults the configured data source to mock", () => {
    expect(DATA_SOURCE).toBe("mock");
  });

  it("shows one revision as a status label, not an empty selector", () => {
    render(
      <RevisionSelector
        onChange={() => undefined}
        revisions={[baseRevision]}
        selectedRevision={2}
      />,
    );

    expect(screen.getByText("Revision 2")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers only supplied revisions, by number", () => {
    const onChange = vi.fn();
    render(
      <RevisionSelector
        onChange={onChange}
        revisions={[
          withStatus("superseded", 1),
          withStatus("current", 2),
          withStatus("upcoming", 3),
        ]}
        selectedRevision={2}
      />,
    );

    const selector = screen.getByRole("combobox", { name: "Revision" });
    expect(Array.from((selector as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "1",
      "2",
      "3",
    ]);
    fireEvent.change(selector, { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it.each([
    ["no alert on the current revision", 2, ["superseded", "current"], null],
    ["a superseded revision", 1, ["superseded", "current"], "Open Revision 2"],
    ["a revision not yet in force", 3, ["current", "upcoming"], "Open Revision 2"],
    ["an upcoming revision while reading the current one", 2, ["current", "upcoming"], "View Revision 3"],
  ] as const)("shows the publish alert for %s", (_label, reading, statuses, action) => {
    const first = statuses[0] === "superseded" ? 1 : 2;
    const revisions = statuses.map((status, index) => withStatus(status, first + index));
    render(
      <MemoryRouter>
        <RevisionAlert docId="FM-S100" revision={reading} revisions={revisions} />
      </MemoryRouter>,
    );

    if (action === null) {
      expect(screen.queryByRole("status")).toBeNull();
    } else {
      expect(screen.getByRole("link", { name: action }).getAttribute("href")).toBe(
        `/reader/FM-S100/${action.slice(-1)}`,
      );
    }
  });

  it("renders accessible loading, empty, and error states with retry", () => {
    const retry = vi.fn();
    const { rerender } = render(<LoadingState label="Loading navigation…" />);
    expect(screen.getByRole("status").textContent).toBe("Loading navigation…");

    rerender(<EmptyState message="No documents are available." />);
    expect(screen.getByRole("status").textContent).toBe(
      "No documents are available.",
    );

    rerender(
      <ApiErrorState
        error={{
          kind: "network",
          code: "NETWORK_ERROR",
          message: "Unable to reach the API.",
        }}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Unable to reach the API.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows the explicit frontend not-found route", () => {
    render(
      <MemoryRouter initialEntries={["/not-a-frontend-route"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  });

  it("keeps current screens on mock data without making fetch requests", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Document library" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    cleanup();
    render(
      <MemoryRouter initialEntries={["/reader/FM-S100/2"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", {
        name: "05.10.16 Autothrottle Crew Awareness",
      }),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
