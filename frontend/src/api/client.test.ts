import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDocumentLibraryFromApi,
  getRevisionNavigationFromApi,
  getTopicContentFromApi,
  resolveNodeFromApi,
} from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const documentIdentity = {
  id: "FM-S100",
  namespace: "urn:sample:fltpub:1.0",
  docType: "FM",
};

const metadata = {
  docId: "FM-S100",
  title: "Sample Flight Manual - SAMPLE-100",
  docType: "FM",
  applicability: "SAMPLE-100",
  revision: 2,
  revisionDate: "2026-07-01",
  effectiveDate: "2026-07-15",
  owner: "Sample Flight Standards",
  changeSummary: "Sample change summary.",
  classification: "SYNTHETIC SAMPLE - NOT FOR OPERATIONAL USE",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("typed API client", () => {
  it("loads and validates the Document Library", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        documents: [
          {
            ...documentIdentity,
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
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getDocumentLibraryFromApi();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/", {
      headers: { Accept: "application/json" },
    });
  });

  it("requests a revision navigation endpoint with encoded IDs and trailing slash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        document: documentIdentity,
        version: { revision: 2, metadata },
        chapters: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getRevisionNavigationFromApi("FM/S 100", 2);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/FM%2FS%20100/revisions/2/navigation/",
      { headers: { Accept: "application/json" } },
    );
  });

  it("requests and validates one topic response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        document: documentIdentity,
        version: {
          revision: 2,
          revisionDate: "2026-07-01",
          effectiveDate: "2026-07-15",
        },
        topic: {
          id: "fm100-t0340",
          number: "05.10.16",
          title: "Autothrottle Crew Awareness",
          chapterId: "fm100-c05",
          sectionId: "fm100-s019",
          blocks: [{ type: "list", id: "fm100-p03216", items: ["First"] }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTopicContentFromApi(
      "FM-S100",
      2,
      "topic/0340",
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/FM-S100/revisions/2/topics/topic%2F0340/",
      { headers: { Accept: "application/json" } },
    );
  });

  it("resolves a permanent node ID with an optional explicit revision", async () => {
    const resolution = {
      documentId: "FM-S100",
      selectedRevision: 2,
      chapterId: "fm100-c05",
      sectionId: "fm100-s019",
      topicId: "fm100-t0340",
      targetNodeId: "fm100-p03219",
      targetType: "check",
      topic: {
        id: "fm100-t0340",
        number: "05.10.16",
        title: "Autothrottle Crew Awareness",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(resolution));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveNodeFromApi("FM/S100", "fm100-p03219", 2);

    expect(result).toEqual({ ok: true, data: resolution });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/FM%2FS100/resolve-node/?nodeId=fm100-p03219&revision=2",
      { headers: { Accept: "application/json" } },
    );
  });

  it("omits the revision parameter when resolving to the current effective revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        documentId: "FM-S100",
        selectedRevision: 2,
        chapterId: "fm100-c05",
        sectionId: "fm100-s019",
        topicId: "fm100-t0340",
        targetNodeId: "fm100-t0340",
        targetType: "topic",
        topic: {
          id: "fm100-t0340",
          number: "05.10.16",
          title: "Autothrottle Crew Awareness",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveNodeFromApi("FM-S100", "fm100-t0340");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/FM-S100/resolve-node/?nodeId=fm100-t0340",
      { headers: { Accept: "application/json" } },
    );
  });

  it("returns a contract-shaped 404 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "NODE_NOT_FOUND",
              message: "The node ID does not exist in the selected document revision.",
            },
          },
          404,
        ),
      ),
    );

    const result = await getTopicContentFromApi("FM-S100", 2, "missing");

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "http",
        code: "NODE_NOT_FOUND",
        message: "The node ID does not exist in the selected document revision.",
        status: 404,
      },
    });
  });

  it("returns an unknown contract error code without rejecting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: "TEMPORARY_MAINTENANCE", message: "Try later." } },
          503,
        ),
      ),
    );

    const result = await getDocumentLibraryFromApi();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TEMPORARY_MAINTENANCE");
      expect(result.error.status).toBe(503);
    }
  });

  it("handles malformed JSON without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(getDocumentLibraryFromApi()).resolves.toMatchObject({
      ok: false,
      error: { kind: "invalid-json", code: "INVALID_JSON" },
    });
  });

  it("handles JSON with an invalid response shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ documents: "no" })));

    await expect(getDocumentLibraryFromApi()).resolves.toMatchObject({
      ok: false,
      error: { kind: "invalid-response", code: "INVALID_RESPONSE" },
    });
  });

  it("handles network failures without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(getDocumentLibraryFromApi()).resolves.toMatchObject({
      ok: false,
      error: { kind: "network", code: "NETWORK_ERROR" },
    });
  });

  it("handles a non-JSON response without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    await expect(getDocumentLibraryFromApi()).resolves.toMatchObject({
      ok: false,
      error: { kind: "non-json", code: "NON_JSON_RESPONSE", status: 502 },
    });
  });
});
