import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Browser tests for the reader screens: compare, notes, the revision alert, and the
// library and reader features added for the airline feedback. Same setup as
// regression.e2e.ts (React + Django with every sample manual); desktop Chrome only.

const API = "http://127.0.0.1:8100";
const heading = (page: Page) => page.locator("h1").first();

interface Revision {
  revision: number;
  status: "current" | "upcoming" | "superseded";
}

/** The revisions of a document as the server labels them today, so the tests follow the calendar. */
async function revisionsOf(page: Page, docId: string): Promise<Revision[]> {
  const response = await page.request.get(`${API}/api/documents/`);
  const library = (await response.json()) as { documents: { id: string; availableRevisions: Revision[] }[] };
  return library.documents.find((document) => document.id === docId)?.availableRevisions ?? [];
}

/** Selects some words of a paragraph by dragging, as a pilot would. */
async function selectWords(page: Page, blockId: string) {
  const paragraph = page.locator(`[id="${blockId}"] p`).first();
  const box = (await paragraph.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 10, { steps: 8 });
  await page.mouse.up();
}

test.describe("revision alert", () => {
  test("reading the current revision announces the upcoming one", async ({ page }) => {
    const revisions = await revisionsOf(page, "FM-S100");
    const current = revisions.find((entry) => entry.status === "current")!;
    const upcoming = revisions.find((entry) => entry.status === "upcoming" && entry.revision > current.revision);
    test.skip(!upcoming, "FM-S100 has no upcoming revision today");

    await page.goto(`/reader/FM-S100/${current.revision}`);
    const alert = page.locator(".revision-alert");
    await expect(alert).toContainText("New revision available");
    await expect(alert).toContainText(`Revision ${upcoming!.revision}`);
    await alert.getByRole("link", { name: `View Revision ${upcoming!.revision}` }).click();
    await expect(page).toHaveURL(new RegExp(`/reader/FM-S100/${upcoming!.revision}`));
    await expect(page.locator(".revision-alert")).toContainText("not in force yet");
  });

  test("a superseded revision points to the one in force", async ({ page }) => {
    const revisions = await revisionsOf(page, "FM-S100");
    const current = revisions.find((entry) => entry.status === "current")!;
    const old = revisions.find((entry) => entry.status === "superseded")!;

    await page.goto(`/reader/FM-S100/${old.revision}`);
    const alert = page.locator(".revision-alert");
    await expect(alert).toContainText(`superseded Revision ${old.revision}`);
    await alert.getByRole("link", { name: `Open Revision ${current.revision}` }).click();
    await expect(page).toHaveURL(new RegExp(`/reader/FM-S100/${current.revision}`));
  });

  test("a pilot can acknowledge the new revision; it is remembered and reading carries on", async ({ page }) => {
    const revisions = await revisionsOf(page, "FM-S100");
    const current = revisions.find((entry) => entry.status === "current")!;
    test.skip(!revisions.some((entry) => entry.status === "upcoming"), "FM-S100 has no upcoming revision today");

    await page.goto(`/reader/FM-S100/${current.revision}`);
    const alert = page.locator(".revision-alert");
    await alert.getByRole("button", { name: "Acknowledge" }).click();
    await expect(alert).toContainText("Acknowledged on");
    await expect(heading(page)).toBeVisible();

    await page.reload();
    await expect(page.locator(".revision-alert")).toContainText("Acknowledged on");
    await expect(page.locator(".revision-alert").getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  });
});

test.describe("compare page", () => {
  const key = JSON.parse(
    readFileSync(new URL("../../sample-data/revision-keys/FM-S100_Rev1_to_Rev2.json", import.meta.url), "utf-8"),
  ) as { topics: Record<"added" | "removed" | "moved" | "modified", { id: string; number: string }[]> };

  test("Revision 1 to 2 matches the answer key", async ({ page }) => {
    await page.goto("/compare/FM-S100?from=1&to=2");
    await expect(heading(page)).toHaveText("FM-S100: Revision 1 → Revision 2");

    const filters = page.getByRole("group", { name: "Filter changes" });
    for (const kind of ["added", "removed", "moved", "modified"] as const) {
      await expect(filters.getByRole("button", { name: new RegExp(`^${kind}`) })).toContainText(
        String(key.topics[kind].length),
      );
    }

    await filters.getByRole("button", { name: /^added/ }).click();
    const list = page.locator(".compare-list");
    for (const topic of key.topics.added) await expect(list).toContainText(topic.number);
    await filters.getByRole("button", { name: /^removed/ }).click();
    for (const topic of key.topics.removed) await expect(list).toContainText(topic.number);
  });

  test("a changed topic opens its side-by-side comparison", async ({ page }) => {
    await page.goto("/compare/FM-S100?from=1&to=2");
    const first = page.locator(".compare-row__toggle").first();
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".compare-row").first()).toContainText(/Revision 1|Revision 2|added|removed/i);
  });
});

test.describe("notes", () => {
  test("a note can be created, edited and deleted, and survives a reload", async ({ page }) => {
    await page.goto("/reader/FM-S100/2");
    const name = page.locator("aside input").first();
    if (await name.count()) {
      await name.fill("Test Pilot");
      await page.getByRole("button", { name: "Save" }).first().click();
    }

    await selectWords(page, "fm100-p10029");
    await page.getByRole("toolbar", { name: "Annotate selection" }).getByRole("button", { name: "Note" }).click();
    await page.getByRole("textbox", { name: "Your note" }).fill("Check with dispatch first.");
    await page.getByRole("button", { name: "Save note" }).click();
    const note = page.getByRole("complementary", { name: "Your note" });
    await expect(note).toContainText("Check with dispatch first.");

    await page.reload();
    await expect(note).toContainText("Check with dispatch first.");

    await note.getByRole("button", { name: "Edit note" }).click();
    await page.getByRole("textbox", { name: "Your note" }).fill("Check with dispatch and the captain.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(note).toContainText("Check with dispatch and the captain.");

    await note.getByRole("button", { name: "Edit note" }).click();
    await page.getByRole("button", { name: "Delete note" }).click();
    await expect(note).toHaveCount(0);
    await page.reload();
    await expect(heading(page)).toBeVisible();
    await expect(note).toHaveCount(0);
  });
});

test.describe("library checklists", () => {
  test("the Checklists section comes before the manuals and opens a checklist by its ID", async ({ page }) => {
    await page.goto("/");
    const checklists = page.getByRole("region", { name: "Checklists" });
    await expect(checklists.getByRole("button", { name: /^Preflight/ })).toBeVisible();
    const sectionTop = (await checklists.boundingBox())!.y;
    const manualsTop = (await page.getByRole("region", { name: "Available documents" }).boundingBox())!.y;
    expect(sectionTop).toBeLessThan(manualsTop);

    await checklists.getByRole("button", { name: /^Preflight/ }).click();
    const link = checklists.getByRole("list", { name: "Preflight checklists" }).getByRole("link").first();
    const checklistId = new URL(String(await link.getAttribute("href")), "http://x").searchParams.get("node")!;
    await link.click();
    await expect(page).toHaveURL(/\/reader\/FM-S100\//);
    await expect(page.locator(`[id="${checklistId}"]`).first()).toBeInViewport();
  });
});

test.describe("reader layout", () => {
  test("the contents and notes panels can be hidden, and stay hidden after a reload", async ({ page }) => {
    await page.goto("/reader/FM-S100/2");
    const contents = page.getByRole("complementary", { name: "Document navigation" });
    const sidePanel = page.getByRole("complementary", { name: "On this page" });
    await expect(contents).toBeVisible();
    await expect(sidePanel).toBeVisible();

    await page.getByRole("button", { name: "Hide contents" }).click();
    await page.getByRole("button", { name: "Hide notes panel" }).click();
    await expect(contents).toBeHidden();
    await expect(sidePanel).toBeHidden();
    await expect(heading(page)).toBeVisible();

    await page.reload();
    await expect(contents).toBeHidden();
    await expect(sidePanel).toBeHidden();
    await page.getByRole("button", { name: "Show contents" }).click();
    await expect(contents).toBeVisible();
  });

  test("an MEL topic says its MEL item is not shown yet", async ({ page }) => {
    await page.goto("/reader/MEL-S100/9");
    const notice = page.getByRole("note").filter({ hasText: "MEL item" });
    await expect(notice).toContainText("Print view (PDF)");
    await page.getByRole("button", { name: "Print view (PDF)" }).click();
    await expect(notice).toHaveCount(0);
  });
});

test.describe("offline and server messages", () => {
  test("offline says so, then loads by itself when the connection is back", async ({ page, context }) => {
    await page.goto("/reader/FM-S100/2");
    await expect(heading(page)).toBeVisible();

    await context.setOffline(true);
    // Move to another manual inside the app, as a pilot would, so it has to ask the server.
    await page.evaluate(() => {
      history.pushState({}, "", "/reader/WOM/7");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByRole("alert").first()).toContainText("You're offline.");

    await context.setOffline(false);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(heading(page)).toBeVisible();
  });

  test("a server that is down is named as such", async ({ page }) => {
    // What the development proxy answers when the API server is not running.
    // Only the API: the app's own files live under /src/api/ and must still load.
    await page.route((url) => url.pathname.startsWith("/api/"), (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "proxy error" }),
    );
    await page.goto("/reader/FM-S100/2");
    await expect(page.getByRole("alert").first()).toContainText("The EFB server is not responding.");
  });
});
