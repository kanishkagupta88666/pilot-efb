import { defineConfig } from "@playwright/test";

// Browser regression tests. They start their own API (fresh database, all
// sample manuals; see scripts/e2e-backend.sh) and the Vite server in API mode.
// Chrome is used from the machine; set E2E_CHANNEL= (empty) to use the
// Chromium that `npx playwright install chromium` downloads instead.
const channel = process.env.E2E_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5200",
    channel: channel || undefined,
    viewport: { width: 1366, height: 1024 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "../scripts/e2e-backend.sh",
      url: "http://127.0.0.1:8100/api/health/",
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5200 --strictPort",
      url: "http://127.0.0.1:5200/",
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: "ignore",
      env: {
        VITE_DATA_SOURCE: "api",
        API_PROXY_TARGET: "http://127.0.0.1:8100",
      },
    },
  ],
});
