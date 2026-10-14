import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentLibraryResponse,
  ResolveNodeResponse,
  RevisionNavigationResponse,
  TopicContentResponse,
} from "../types/api";
import { ContentBlocks } from "./ContentBlocks";
import { ApiDocumentLibrary } from "./DocumentLibrary";
import { ApiReader } from "./ApiReader";
import { ApiOpenNodeRoute } from "./OpenNodeRoute";

const metadata = {
  docId: "FM-S100",
  title: "Synthetic manual",
  docType: "FM",
  applicability: "SAMPLE-100",
  revision: 2,
  revisionDate: "2026-07-01",
  effectiveDate: "2026-07-15",
  owner: "Synthetic owner",
  changeSummary: "Synthetic revision.",
  classification: "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE",
};

const library: DocumentLibraryResponse = {
  documents: [
    {
      id: "FM-S100",
      namespace: "urn:sample:fltpub:1.0",
      docType: "FM",
      availableRevisions: [
        {
          revision: 2,
          revisionDate: "2026-07-01",
          effectiveDate: "2026-07-15",
          status: "current",
          metadata,
        },
      ],
    },
  ],
};

const navigation: RevisionNavigationResponse = {
  document: {
    id: "FM-S100",
    namespace: "urn:sample:fltpub:1.0",
    docType: "FM",
  },
  version: { revision: 2, metadata },
  chapters: [
    {
      id: "fm100-c05",
      number: "05",
      title: "Synthetic chapter",
      sections: [
        {
          id: "fm100-s019",
          number: "05.10",
          title: "Synthetic section",
          topics: [
            {
              id: "fm100-t0340",
              number: "05.10.16",
              title: "Synthetic topic",
            },
          ],
        },
      ],
    },
  ],
};

const topic: TopicContentResponse = {
  document: navigation.document,
  version: {
    revision: 2,
    revisionDate: metadata.revisionDate,
    effectiveDate: metadata.effectiveDate,
  },
  topic: {
    id: "fm100-t0340",
    number: "05.10.16",
    title: "Synthetic topic",
    chapterId: "fm100-c05",
    sectionId: "fm100-s019",
    blocks: [
      {
        type: "para",
        id: "fm100-p00673",
        segments: [
          { type: "text", text: "Synthetic paragraph. See " },
          {
            type: "xref",
            targetId: "fm100-t0756",
            text: "unavailable synthetic topic",
          },
          { type: "text", text: " for details." },
        ],
      },
      {
        type: "checklist",
        id: "fm100-p03218",
        checks: [
          {
            id: "fm100-p03219",
            challenge: "Synthetic challenge",
            response: "Synthetic response",
          },
        ],
      },
    ],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiFetch(
  overrides: Record<string, () => Response> = {},
) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const override = Object.entries(overrides).find(([path]) =>
      url.includes(path),
    )?.[1];
    if (override) return Promise.resolve(override());
    if (url.endsWith("/api/documents/")) {
      return Promise.resolve(jsonResponse(library));
    }
    if (url.endsWith("/navigation/")) {
      return Promise.resolve(jsonResponse(navigation));
    }
    if (url.endsWith("/topics/fm100-t0340/")) {
      return Promise.resolve(jsonResponse(topic));
    }
    return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "Missing." } }, 404));
  });
}

function renderApiReader(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/reader/:docId/:revision" element={<ApiReader />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe("API-backed frontend", () => {
  it("loads library documents and reports empty results", async () => {
    vi.stubGlobal("fetch", apiFetch());
    render(
      <MemoryRouter>
        <ApiDocumentLibrary />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Synthetic manual" })).toBeTruthy();
    expect(screen.getByText("1 Jul 2026")).toBeTruthy();
    expect(screen.getByText("15 Jul 2026")).toBeTruthy();
  });

  it("shows an empty state when the API library has no documents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ documents: [] })),
    );
    render(
      <MemoryRouter>
        <ApiDocumentLibrary />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No documents are available.")).toBeTruthy();
  });

  it("provides a retry action for library failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "INTERNAL_ERROR", message: "Temporary failure." } },
          500,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(library));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <ApiDocumentLibrary />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Temporary failure.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Synthetic manual" })).toBeTruthy();
  });

  it.each([
    ["paragraph", "fm100-p00673", "para"],
    ["checklist check", "fm100-p03219", "check"],
    ["topic", "fm100-t0340", "topic"],
    ["chapter", "fm100-c05", "chapter"],
    ["section", "fm100-s019", "section"],
  ])("loads and scrolls to the resolved %s target", async (_label, nodeId, targetType) => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal("fetch", apiFetch());
    const entry =
      `/reader/FM-S100/2?topicId=fm100-t0340&chapterId=fm100-c05&sectionId=fm100-s019` +
      `&nodeId=${nodeId}&targetType=${targetType}`;

    const { container } = renderApiReader(entry);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(container.querySelector(`#${nodeId}`)?.className).toContain(
      "content-block--targeted",
    );
    expect(screen.getByText("SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE")).toBeTruthy();
    expect(
      container.querySelector(".navigation-toggle")?.getAttribute("aria-expanded"),
    ).toBe(targetType === "chapter" || targetType === "section" ? "true" : "false");
  });

  it("does not substitute another revision when the requested revision is unavailable", async () => {
    const fetchMock = apiFetch({
      "/revisions/3/navigation/": () =>
        jsonResponse(
          {
            error: {
              code: "REVISION_NOT_FOUND",
              message: "The revision is not available for this document.",
            },
          },
          404,
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApiReader("/reader/FM-S100/3");
    expect(
      await screen.findByText("The revision is not available for this document."),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/topics/"))).toBe(false);
  });

  it("does not resolve API cross-references until a user activates the link", async () => {
    const fetchMock = apiFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderApiReader("/reader/FM-S100/2");

    const xref = await screen.findByRole("link", {
      name: "unavailable synthetic topic",
    });
    expect(xref.getAttribute("href")).toBe(
      "/open?doc=FM-S100&node=fm100-t0756&rev=2",
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("resolve-node"))).toBe(false);
    expect(container.querySelector("#fm100-p00673")?.textContent).toContain(
      "Synthetic paragraph. See unavailable synthetic topic for details.",
    );
  });

  it("resolves an API cross-reference on activation and navigates to backend-selected data", async () => {
    const resolution: ResolveNodeResponse = {
      documentId: "FM-S100",
      selectedRevision: 2,
      chapterId: "fm100-c05",
      sectionId: "fm100-s019",
      topicId: "fm100-t0756",
      targetNodeId: "fm100-t0756",
      targetType: "topic",
      topic: {
        id: "fm100-t0756",
        number: "11.20.1",
        title: "Synthetic cross-reference target",
      },
    };
    const fetchMock = apiFetch({
      "/resolve-node/": () => jsonResponse(resolution),
    });
    vi.stubGlobal("fetch", fetchMock);

    function LocationView() {
      const location = useLocation();
      return <p role="status">{location.pathname}{location.search}</p>;
    }

    render(
      <MemoryRouter initialEntries={["/reader/FM-S100/2"]}>
        <Routes>
          <Route
            path="/reader/FM-S100/2"
            element={
              <>
                <LocationView />
                <ContentBlocks
                  completedChecks={{}}
                  dataSource="api"
                  docId="FM-S100"
                  onResetChecks={() => undefined}
                  onToggleCheck={() => undefined}
                  revision={2}
                  topic={topic.topic}
                />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const xref = screen.getByRole("link", { name: "unavailable synthetic topic" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(xref);
    expect(
      await screen.findByText(
        "/reader/FM-S100/2?topicId=fm100-t0756&chapterId=fm100-c05&sectionId=fm100-s019&nodeId=fm100-t0756&targetType=topic",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/FM-S100/resolve-node/?nodeId=fm100-t0756&revision=2",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("shows a failed xref as non-clickable text when the target is unavailable", async () => {
    const fetchMock = apiFetch({
      "/resolve-node/": () =>
        jsonResponse(
          {
            error: {
              code: "NODE_NOT_FOUND",
              message: "The node ID does not exist in the selected document revision.",
            },
          },
          404,
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/reader/FM-S100/2"]}>
        <ContentBlocks
          completedChecks={{}}
          dataSource="api"
          docId="FM-S100"
          onResetChecks={() => undefined}
                  onToggleCheck={() => undefined}
          revision={2}
          topic={topic.topic}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "unavailable synthetic topic" }));
    expect(
      await screen.findByText("Not available in this revision."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "unavailable synthetic topic" }),
    ).toBeNull();
  });

  it("calls the resolver only after an open-link route is entered and navigates to its exact revision", async () => {
    const resolution: ResolveNodeResponse = {
      documentId: "FM-S100",
      selectedRevision: 2,
      chapterId: "fm100-c05",
      sectionId: "fm100-s019",
      topicId: "fm100-t0340",
      targetNodeId: "fm100-p00673",
      targetType: "para",
      topic: {
        id: "fm100-t0340",
        number: "05.10.16",
        title: "Synthetic topic",
      },
    };
    const fetchMock = apiFetch({
      "/resolve-node/": () => jsonResponse(resolution),
    });
    vi.stubGlobal("fetch", fetchMock);

    function LocationView() {
      const location = useLocation();
      return <p role="status">{location.pathname}{location.search}</p>;
    }

    render(
      <MemoryRouter initialEntries={["/open?doc=FM-S100&node=fm100-p00673"]}>
        <Routes>
          <Route
            path="/open"
            element={<ApiOpenNodeRoute dataSource="api" />}
          />
          <Route path="/reader/:docId/:revision" element={<LocationView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "/reader/FM-S100/2?topicId=fm100-t0340&chapterId=fm100-c05&sectionId=fm100-s019&nodeId=fm100-p00673&targetType=para",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/FM-S100/resolve-node/?nodeId=fm100-p00673",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("rejects non-canonical explicit revisions without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/open?doc=FM-S100&node=fm100-p00673&rev=02"]}>
        <ApiOpenNodeRoute dataSource="api" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("The revision must be a whole number without leading zeroes."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
