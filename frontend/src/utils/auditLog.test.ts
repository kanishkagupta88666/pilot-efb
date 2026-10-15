import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushAudit, pendingEvents, recordAudit } from "./auditLog";

// jsdom has no IndexedDB, so these exercise the in-memory outbox, which
// follows the same send-and-confirm rules as the IndexedDB one.

function reply(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("audit outbox", () => {
  const sent: unknown[] = [];
  let online = true;

  beforeEach(async () => {
    sent.length = 0;
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    // Start each test with an empty outbox.
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      const events = (JSON.parse(String(init.body)) as { events: { id: string }[] }).events;
      return reply({ accepted: events.map((e) => e.id), duplicates: [], rejected: [] });
    }));
    await flushAudit();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps events recorded offline until the server confirms them", async () => {
    online = false;
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await recordAudit("document.opened", { documentId: "FM-S100", revision: 2 });
    await recordAudit("search.performed", { details: { query: "anti-ice" } });

    const waiting = await pendingEvents();
    expect(waiting.map((e) => e.action)).toEqual(["document.opened", "search.performed"]);
    expect(waiting.every((e) => e.recordedOffline)).toBe(true);

    // Still offline: a send attempt fails and nothing is lost.
    await flushAudit();
    expect(await pendingEvents()).toHaveLength(2);

    // Back online: the server confirms and the outbox empties.
    online = true;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      const events = (JSON.parse(String(init.body)) as { events: { id: string }[] }).events;
      sent.push(...events);
      return reply({ accepted: events.map((e) => e.id), duplicates: [], rejected: [] });
    }));
    await flushAudit();
    expect(await pendingEvents()).toHaveLength(0);
    expect(sent).toHaveLength(2);
  });

  it("removes events the server already had", async () => {
    online = false;
    await recordAudit("pdf.viewed");
    online = true;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      const events = (JSON.parse(String(init.body)) as { events: { id: string }[] }).events;
      return reply({ accepted: [], duplicates: events.map((e) => e.id), rejected: [] });
    }));
    await flushAudit();
    expect(await pendingEvents()).toHaveLength(0);
  });

  it("keeps events when the server answers with an error", async () => {
    online = false;
    await recordAudit("pdf.viewed");
    online = true;
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "x" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })),
    ));
    await flushAudit();
    expect(await pendingEvents()).toHaveLength(1);
  });
});
