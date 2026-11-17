// Helpers shared by the end-to-end specs.

import { expect } from "@playwright/test";
import { DEFAULT_STUDY_CONFIG, cloneConfig } from "../src/study-config.js";
import { RESEARCH_URL, TEST_SUBMIT_TOKEN, TEST_ADMIN_TOKEN } from "./e2e-settings.js";

export const DEMO_KEY = "agecheck.demo.records.v1";
export const RESEARCH_KEY = "agecheck.research.records.v1";
export const CONFIG_KEY = "agecheck.config.v1";
export const SESSION_KEY = "agecheck.session.v1";
export const DRAFTS_KEY = "agecheck.drafts.v1";
export const NOTICE = "If the facial check cannot confidently confirm your age, you may be asked to provide a government-issued ID.";

/** Records every attempt to touch a camera, microphone, or permission API. */
export async function installSpies(page) {
  await page.addInitScript(() => {
    const calls = [];
    window.__mediaCalls = calls;
    const md = navigator.mediaDevices;
    if (md) {
      for (const fn of ["getUserMedia", "getDisplayMedia", "enumerateDevices"]) {
        md[fn] = () => {
          calls.push(fn);
          return Promise.reject(new Error("blocked by test"));
        };
      }
    }
    navigator.getUserMedia = () => calls.push("legacy getUserMedia");
    if (navigator.permissions && navigator.permissions.query) {
      const orig = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) => {
        calls.push(`permissions.query:${d && d.name}`);
        return orig(d);
      };
    }
  });
}

/** Opens the participant app with a fresh session. `origin` selects the server ("" is the preview one). */
export async function open(page, { condition = null, extra = "", origin = "", spies = true } = {}) {
  if (spies) await installSpies(page);
  const q = ["reset=1"];
  if (condition) q.push(`condition=${condition}`);
  await page.goto(`${origin}/index.html?${q.join("&")}${extra}`);
  await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
}

export async function toConsent(page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Before you begin" })).toBeVisible();
  await page.getByRole("radio", { name: "16", exact: true }).check();
  await page.getByRole("checkbox", { name: /approved Prosper-area/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Study information and assent" })).toBeVisible();
}

export async function toVerification(page) {
  await toConsent(page);
  await page.getByRole("checkbox", { name: /agree to take part/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A fictional platform" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your age group" })).toBeVisible();
}

export async function startCheckToResult(page) {
  await page.getByRole("button", { name: "Start simulated check" }).click();
  await expect(page.getByText("Simulated check", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /could not confidently confirm/ })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("This is a simulation. Do not provide a real ID.")).toBeVisible();
}

/** From the verification screen to the questionnaire by one of the three routes. */
export async function toQuestionnaire(page, route = "stop") {
  if (route === "decline") {
    await page.getByRole("button", { name: "Decline verification" }).click();
  } else {
    await startCheckToResult(page);
    await page.getByRole("button", { name: route === "continue" ? "I would continue with ID verification" : "I would stop here" }).click();
  }
  await page.getByRole("button", { name: "Continue to the questions" }).click();
  await expect(page.getByRole("heading", { name: "Your experience" })).toBeVisible();
}

export async function fillAndSubmitQuestionnaire(page, { answerAll = true } = {}) {
  await expect(page.getByRole("heading", { name: "Your experience" })).toBeVisible();
  if (answerAll) {
    const items = page.locator("fieldset.likert");
    const n = await items.count();
    for (let i = 0; i < n; i += 1) await items.nth(i).getByRole("radio").nth(3).check();
    for (const id of ["recall_notice", "prior_experience", "id_availability", "breach_awareness"]) {
      await page.locator(`fieldset[data-item="${id}"] input`).first().check();
    }
    await page.locator("#open_influence").fill("Test run. No personal details.");
    const reasons = page.locator('fieldset[data-item="stop_reasons"] input');
    if (await reasons.count()) await reasons.first().check();
  }
  await page.getByRole("button", { name: "Submit answers" }).click();
  await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
  await expect(page.locator("#response-code")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
}

export async function records(page, key = DEMO_KEY) {
  return page.evaluate((k) => Object.values(JSON.parse(localStorage.getItem(k) || "{}")), key);
}

export async function drafts(page) {
  return page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || "{}"), DRAFTS_KEY);
}

export async function assertNoDeviceAccess(page) {
  expect(await page.evaluate(() => window.__mediaCalls)).toEqual([]);
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  expect(await page.locator("video, canvas").count()).toBe(0);
}

/** A configuration that passes every research-mode check. */
export function researchConfig(adapter = "local-device", overrides = {}) {
  const c = cloneConfig(DEFAULT_STUDY_CONFIG);
  c.mode = "research";
  c.frozen = true;
  c.studyVersion = "1.0.0";
  c.withdrawal.retainPartialResponses = false;
  c.storage =
    adapter === "remote-endpoint"
      ? { adapter, endpointUrl: RESEARCH_URL, submitToken: TEST_SUBMIT_TOKEN }
      : { adapter, endpointUrl: "", submitToken: "" };
  for (const k of Object.keys(c.consent)) {
    if (typeof c.consent[k] === "string") c.consent[k] = c.consent[k].replace(/\[[^\]]*\]/g, "Filled wording for tests.");
  }
  Object.assign(c, overrides);
  return c;
}

/** Saves a configuration in this browser, as the dashboard's Save would. */
export async function setLocalConfig(page, config, origin = "") {
  await page.goto(`${origin}/index.html`);
  await page.evaluate(([k, cfg]) => localStorage.setItem(k, JSON.stringify(cfg)), [CONFIG_KEY, config]);
}

/** The research test server's admin API. */
export function researchServer(request) {
  const auth = { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
  const api = {
    async records() {
      const res = await request.get(`${RESEARCH_URL}/api/admin/records`, { headers: auth });
      expect(res.status()).toBe(200);
      return (await res.json()).records;
    },
    async clear() {
      for (const r of await api.records()) {
        await request.delete(`${RESEARCH_URL}/api/admin/records/${r.response_code}`, { headers: auth });
      }
    },
    async deploy(config) {
      await api.clear();
      const res = await request.put(`${RESEARCH_URL}/api/admin/config`, { headers: auth, data: config });
      expect(res.status(), JSON.stringify(await res.json())).toBe(200);
    },
  };
  return api;
}
