// Regenerates the screenshots in docs/screenshots from the running app.
// Run: node tools/screenshots.js   (needs `npm install`; uses the installed Microsoft Edge)
//
// It starts its own copy of the reference server in preview mode with a
// throwaway data directory, so it never touches real data.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "../server/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "docs", "screenshots");
fs.mkdirSync(out, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agecheck-shots-"));
const server = await startServer({ port: 0, host: "127.0.0.1", dataDir, log: () => {} });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge" });

const DESKTOP = { width: 1100, height: 820 };
const PHONE = { width: 375, height: 760 };

async function session(viewport, condition) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const page = await context.newPage();
  await page.goto(`${base}/index.html?reset=1&condition=${condition}`);
  return { context, page };
}

async function toVerification(page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: "16", exact: true }).check();
  await page.getByRole("checkbox", { name: /approved Prosper-area/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("checkbox", { name: /agree to take part/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Confirm your age group" }).waitFor();
}

async function toQuestionnaire(page) {
  await page.getByRole("button", { name: "Start simulated check" }).click();
  await page.getByRole("heading", { name: /could not confidently confirm/ }).waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "I would stop here" }).click();
  await page.getByRole("button", { name: "Continue to the questions" }).click();
  await page.getByRole("heading", { name: "Your experience" }).waitFor();
}

const shot = (page, name, options = {}) => page.screenshot({ path: path.join(out, `${name}.png`), ...options });

// 1. The verification screen in both conditions, on a phone and on a desktop.
for (const [label, viewport] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  for (const condition of ["advance", "later"]) {
    const { context, page } = await session(viewport, condition);
    await toVerification(page);
    await shot(page, `verification-${condition}-${label}`);
    await context.close();
  }
}

// 2. Questionnaire with an answer selected (the Clear answer control), and the withdrawal dialog over it.
for (const [label, viewport] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const { context, page } = await session(viewport, "advance");
  await toVerification(page);
  await toQuestionnaire(page);
  await page.locator("fieldset.likert").nth(0).getByRole("radio").nth(3).check();
  await page.locator("fieldset.likert").nth(1).getByRole("radio").nth(1).check();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `questionnaire-clear-answer-${label}`);
  await page.getByRole("button", { name: "Withdraw from study" }).click();
  await page.getByRole("dialog").waitFor();
  await shot(page, `withdraw-dialog-${label}`);
  await context.close();
}

// 3. Storage failure: the progress notice, then a withdrawal that could not be saved, then saved.
{
  const { context, page } = await session(PHONE, "later");
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    window.__allowStorage = true;
    Storage.prototype.setItem = function (k, v) {
      if (k === "agecheck.demo.records.v1" && !window.__allowStorage) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, k, v);
    };
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: "16", exact: true }).check();
  await page.getByRole("checkbox", { name: /approved Prosper-area/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("checkbox", { name: /agree to take part/ }).check();
  await page.evaluate(() => (window.__allowStorage = false));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#sync-status .notice-box").waitFor();
  await shot(page, "progress-not-saved-phone");
  await page.getByRole("button", { name: "Withdraw from study" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, withdraw" }).click();
  await page.locator('#withdrawal-state[data-state="failed"]').waitFor();
  await shot(page, "withdrawal-not-saved-phone");
  await page.evaluate(() => (window.__allowStorage = true));
  await page.getByRole("button", { name: "Try saving again" }).click();
  await page.locator('#withdrawal-state[data-state="saved"]').waitFor();
  await shot(page, "withdrawal-saved-phone");
  await context.close();
}

// 4. The dashboard: filters and completion outcome, export scope, and a requirements check that keeps unsaved edits.
for (const [label, viewport] of [["desktop", { width: 1200, height: 1000 }], ["phone", PHONE]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const page = await context.newPage();
  await page.goto(`${base}/researcher.html`);
  await page.getByRole("tab", { name: "Demo data" }).click();
  await page.getByRole("button", { name: "Generate (replace demo set)" }).click();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.locator("#filter-status").selectOption("submitted");
  await shot(page, `dashboard-overview-filters-${label}`, { fullPage: true });
  await page.getByRole("tab", { name: "Export" }).click();
  await shot(page, `dashboard-export-scope-${label}`, { fullPage: true });
  await page.getByRole("tab", { name: "Configuration" }).click();
  await page.locator("#cfg-researcher").fill("Edited but not saved yet");
  await page.locator("#cfg-duration").fill("");
  await page.locator("#cfg-check").click();
  await page.locator("#config-problems").scrollIntoViewIfNeeded();
  await shot(page, `dashboard-check-keeps-edits-${label}`);
  await context.close();
}

await browser.close();
await new Promise((r) => server.close(r));
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`screenshots written to ${out}`);
