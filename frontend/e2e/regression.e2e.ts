import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Browser regression tests for the combined app: React reader + Django API
// with the sample manuals. See playwright.config.ts for how it is started.
// These run in desktop Chrome; they say nothing about iPad Safari.

const API = "http://127.0.0.1:8100";
const samples: { docId: string; nodeId: string; expectedNumber: string; expectedTitle: string }[] = JSON.parse(
  readFileSync(new URL("../../sample-data/deep_link_samples.json", import.meta.url), "utf-8"),
).links;

const heading = (page: Page) => page.locator("h1").first();

test.describe("library and XML reader", () => {
  test("the library lists every ingested document, with bulletins under their DMS IDs", async ({ page }) => {
    await page.goto("/");
    const body = page.locator("body");
    for (const id of ["FM-S100", "FM-S200", "FOM", "WOM", "MEL-S100", "BUL-26-01", "BUL-26-02"]) {
      await expect(body).toContainText(id);
    }
    await expect(body).not.toContainText("BULLETIN-26");
  });

  test("a chapter, section and topic open by clicking through the hierarchy", async ({ page }) => {
    await page.goto("/reader/FM-S100/2");
    await page.getByRole("button", { name: /03 Normal Procedures/ }).first().click();
    await page.getByRole("button", { name: /03\.10 / }).first().click();
    await page.getByRole("button", { name: /03\.10\.2 / }).first().click();
    await expect(heading(page)).toContainText("Wing Anti-Ice");
  });

  test("the library opens the current revision", async ({ page }) => {
    await page.goto("/");
    await page.locator('a[aria-label^="Open Sample Flight Manual - SAMPLE-100"]').first().click();
    await expect(page).toHaveURL(/\/reader\/FM-S100\/2/);
  });

  test("a revision that is not yet in force is labelled upcoming and opens", async ({ page }) => {
    await page.goto("/reader/FM-S100/2");
    await page.locator("select").first().selectOption("3");
    await expect(page).toHaveURL(/\/reader\/FM-S100\/3/);
    await expect(page.locator("main")).toContainText(/Upcoming/);
  });

  test("a cross-reference opens its target by permanent ID", async ({ page }) => {
    await page.goto("/open?doc=FM-S100&node=fm100-p00036&rev=2");
    const link = page.locator('[id="fm100-p00036"] a').first();
    await expect(link).toBeVisible();
    const before = await heading(page).innerText();
    await link.click();
    await expect(heading(page)).not.toHaveText(before);
  });

  test("a checklist item can be ticked", async ({ page }) => {
    await page.goto("/open?doc=FM-S100&node=fm100-p00689&rev=2");
    const box = page.locator('[id="fm100-p00689"] input[type=checkbox]');
    await box.check();
    await expect(box).toBeChecked();
  });

  // Known gap (Phase 2B): the open topic and checklist ticks are lost on reload.
  test.fixme("the open topic survives a reload", async ({ page }) => {
    await page.goto("/reader/FM-S100/2");
    await page.getByRole("button", { name: /01\.10\.3 / }).first().click();
    const before = await heading(page).innerText();
    await page.reload();
    await expect(heading(page)).toHaveText(before);
  });
});

test.describe("client sample deep links", () => {
  test("the sample file holds the seven client links", () => {
    expect(samples).toHaveLength(7);
  });

  for (const sample of samples) {
    test(`${sample.nodeId} opens ${sample.expectedNumber} and is highlighted in view`, async ({ page }) => {
      await page.goto(`/open?doc=${sample.docId}&node=${sample.nodeId}`);
      await expect(page).toHaveURL(/\/reader\//);
      await expect(heading(page)).toContainText(sample.expectedNumber);
      await expect(page.locator(`[id="${sample.nodeId}"]`).first()).toBeInViewport();
    });
  }
});

test.describe("search", () => {
  test("a query returns results that open the exact place", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByRole("searchbox", { name: "Search published documents" });
    await input.fill("Anti-Ice");
    await input.press("Enter");
    await expect(page.locator("main")).toContainText(/\d+ results?/);
    const count = Number(((await page.locator("main").innerText()).match(/([\d,]+) results?/) ?? [])[1]?.replace(",", ""));
    expect(count).toBeGreaterThan(0);
    await page.getByRole("button", { name: "FM", exact: true }).click();
    await page.getByRole("region", { name: "Search results" }).getByRole("button").first().click();
    await expect(page).toHaveURL(/\/reader\//);
    await expect(heading(page)).toBeVisible();
  });

  test("the library search box goes to search", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("searchbox", { name: "Search published documents" });
    await box.fill("checklist");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search/);
  });
});

test.describe("PDF print view", () => {
  async function openPrintView(page: Page, path: string) {
    await page.goto(path);
    const pdf = page.waitForResponse((response) => /\/pdf\/$/.test(response.url()));
    await page.getByRole("button", { name: "Print view (PDF)" }).click();
    const response = await pdf;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    await expect(page.locator("canvas").first()).toBeVisible();
    // Drawn, not blank: some pixels are dark.
    await expect
      .poll(() =>
        page.$$eval("canvas", (canvases) =>
          canvases.every((canvas) => {
            const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < data.length; i += 400) if (data[i] < 200) return true;
            return false;
          }),
        ),
      )
      .toBe(true);
  }

  test("an XML manual's PDF is served and drawn", async ({ page }) => {
    await openPrintView(page, "/reader/FM-S100/2");
  });

  test("a PDF-only bulletin's PDF is served and drawn", async ({ page }) => {
    await openPrintView(page, "/reader/BUL-26-01/0");
  });
});

test.describe("error handling", () => {
  test("an unknown revision explains itself and offers Retry", async ({ page }) => {
    await page.goto("/reader/FM-S100/99");
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.locator("body")).toContainText(/revision/i);
  });

  test("a deep link to a node removed in a later revision says so", async ({ page }) => {
    await page.goto("/open?doc=FM-S100&node=fm100-t0008&rev=2");
    await expect(page.locator("main")).toContainText(/removed/i);
  });

  test("an unreachable API shows an alert and Retry recovers", async ({ page }) => {
    await page.route("**/api/documents/**", (route) => route.abort("connectionrefused"));
    await page.goto("/reader/FM-S100/2");
    await expect(page.locator("[role=alert]").first()).toBeVisible();
    await page.unroute("**/api/documents/**");
    await page.getByRole("button", { name: /retry/i }).first().click();
    await expect(heading(page)).toBeVisible();
  });

  test("an annotation the server refuses to sync stays on the device", async ({ page }) => {
    await page.goto("/reader/FM-S100/2");
    const name = page.locator("aside input").first();
    if (await name.count()) {
      await name.fill("Test Pilot");
      await page.getByRole("button", { name: "Save" }).first().click();
    }
    const paragraph = page.locator('[id="fm100-p10029"] p').first();
    const box = (await paragraph.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 240, box.y + 10, { steps: 8 });
    await page.mouse.up();
    await page.getByRole("button", { name: /^highlight$/i }).first().click();
    await expect(page.locator("mark").first()).toBeVisible();
    await page.reload();
    await expect(page.locator("mark").first()).toBeVisible();
  });
});

test.describe("write endpoints are closed by default", () => {
  test("anonymous callers cannot publish, annotate or write the audit log", async ({ request }) => {
    const before = await (await request.get(`${API}/api/documents/`)).json();
    const attempts: [string, string, object][] = [
      ["POST", "/api/documents/FM-S100/draft/", {}],
      ["POST", "/api/documents/FM-S100/draft/publish/", { changeSummary: "x", effectiveDate: "2030-01-01" }],
      ["POST", "/api/annotations/sync/", { owner: "Anyone", changes: [] }],
      ["POST", "/api/audit/events/", { events: [] }],
    ];
    for (const [method, path, data] of attempts) {
      const response = await request.fetch(`${API}${path}`, {
        method,
        data,
        headers: { "X-EFB-Actor": "Chief Pilot", "X-EFB-Role": "administrator", Origin: API },
      });
      expect(response.status(), `${method} ${path}`).toBe(403);
      expect((await response.json()).error.code).toBe("FEATURE_DISABLED");
    }
    const after = await (await request.get(`${API}/api/documents/`)).json();
    expect(after).toEqual(before);
  });
});
