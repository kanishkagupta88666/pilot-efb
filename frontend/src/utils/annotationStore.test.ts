import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAnnotation, annotationsFor, syncAnnotations, unsyncedCount } from "./annotationStore";
import { setProfile } from "./deviceIdentity";

// jsdom has no IndexedDB, so this exercises the in-memory store, which
// follows the same rules as the IndexedDB one.

/** Echo the device's changes back the way the server writes times: "+00:00" and microseconds. */
function serverEcho() {
  return vi.fn((_url: string, init: RequestInit) => {
    const { changes } = JSON.parse(String(init.body)) as { changes: { updatedAt: string; createdAt: string }[] };
    const annotations = changes.map((change) => ({
      ...change,
      updatedAt: change.updatedAt.replace(/\.(\d{3})Z$/, ".$1000+00:00"),
      createdAt: change.createdAt.replace(/\.(\d{3})Z$/, ".$1000+00:00"),
    }));
    return Promise.resolve(
      new Response(JSON.stringify({ annotations, rejected: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

const highlight = {
  kind: "highlight" as const,
  documentId: "FM-S100",
  revision: 1,
  topicId: "fm100-t0037",
  topicNumber: "02.10.10",
  nodeId: "fm100-p00260",
  start: 0,
  end: 5,
  quote: "Refer",
  anchorText: "Refer to the related topic.",
  note: "",
};

describe("annotation store", () => {
  let online = true;

  beforeEach(() => {
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    setProfile({ name: `Test Pilot ${Math.random()}`, role: "pilot" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps annotations made offline and syncs them when back online", async () => {
    online = false;
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await addAnnotation(highlight);
    await syncAnnotations();
    expect(await unsyncedCount()).toBe(1);
    expect((await annotationsFor("FM-S100")).map((a) => a.quote)).toEqual(["Refer"]);

    online = true;
    vi.stubGlobal("fetch", serverEcho());
    await syncAnnotations();
    // The server's "+00:00" timestamp is the same instant as the device's "Z" one.
    expect(await unsyncedCount()).toBe(0);
    expect(await annotationsFor("FM-S100")).toHaveLength(1);
  });

  it("is private to the name set on the device", async () => {
    vi.stubGlobal("fetch", serverEcho());
    await addAnnotation(highlight);
    expect(await annotationsFor("FM-S100")).toHaveLength(1);
    setProfile({ name: "Someone Else", role: "pilot" });
    expect(await annotationsFor("FM-S100")).toHaveLength(0);
  });
});
