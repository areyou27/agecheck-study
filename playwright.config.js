// Playwright configuration for the end-to-end tests.
// Uses the Microsoft Edge already installed on the machine (channel "msedge")
// so no browser download is needed. Switch to "chromium" after
// `npx playwright install chromium` if Edge is not available.
//
// Two copies of the reference server run during the tests:
//   4173  as shipped: no tokens, nothing deployed, so the app is in preview mode
//   4174  a research server with test-only tokens, used to test saving,
//         withdrawal, and failures against real requests
// Each gets a throwaway data directory. Neither is ever a real study server.

import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { PREVIEW_PORT, RESEARCH_PORT, TEST_SUBMIT_TOKEN, TEST_ADMIN_TOKEN } from "./tests/e2e-settings.js";

const scratch = path.join(os.tmpdir(), `agecheck-e2e-${process.pid}-${Date.now()}`);

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node server/server.js",
      url: `http://127.0.0.1:${PREVIEW_PORT}/index.html`,
      reuseExistingServer: false,
      env: { PORT: String(PREVIEW_PORT), HOST: "127.0.0.1", AGECHECK_DATA_DIR: path.join(scratch, "preview") },
      timeout: 20_000,
    },
    {
      command: "node server/server.js",
      url: `http://127.0.0.1:${RESEARCH_PORT}/index.html`,
      reuseExistingServer: false,
      env: {
        PORT: String(RESEARCH_PORT),
        HOST: "127.0.0.1",
        AGECHECK_DATA_DIR: path.join(scratch, "research"),
        AGECHECK_SUBMIT_TOKEN: TEST_SUBMIT_TOKEN,
        AGECHECK_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
      },
      timeout: 20_000,
    },
  ],
  projects: [{ name: "desktop", use: { ...devices["Desktop Edge"], channel: "msedge" } }],
});
