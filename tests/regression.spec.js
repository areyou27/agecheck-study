// Regression tests (Playwright) for problems that were found and fixed:
// lost drafts, withdrawal and submission races, unsaved milestones, hidden
// storage failures, invalid configurations, layout differences between the
// conditions on phones, dialog focus, and dashboard arithmetic.
// Run with: npm run test:e2e

import fs from "node:fs";
import { test, expect } from "@playwright/test";
import * as E from "../src/engine.js";
import { DEFAULT_STUDY_CONFIG, cloneConfig } from "../src/study-config.js";
import { RESEARCH_URL } from "./e2e-settings.js";
import {
  DEMO_KEY,
  RESEARCH_KEY,
  SESSION_KEY,
  DRAFTS_KEY,
  NOTICE,
  open,
  toConsent,
  toVerification,
  startCheckToResult,
  toQuestionnaire,
  fillAndSubmitQuestionnaire,
  records,
  drafts,
  researchConfig,
  setLocalConfig,
  researchServer,
} from "./e2e-helpers.js";

// ---------------------------------------------------------------------------
// 1. Unfinished answers

test.describe("drafts", () => {
  const answerSome = async (page) => {
    await page.locator("fieldset.likert").nth(0).getByRole("radio").nth(3).check(); // risk_exposure = 4
    await page.locator("fieldset.likert").nth(2).getByRole("radio").nth(0).check(); // risk_feel = 1
    await page.locator('fieldset[data-item="recall_notice"] input[value="not_sure"]').check();
    await page.locator('fieldset[data-item="stop_reasons"] input[value="too_much_effort"]').check();
    await page.locator('fieldset[data-item="stop_reasons"] input[value="other"]').check();
    await page.locator("#open_influence").fill("A draft answer, not yet submitted.");
  };
  const expectAnswers = async (page) => {
    await expect(page.locator("fieldset.likert").nth(0).getByRole("radio").nth(3)).toBeChecked();
    await expect(page.locator("fieldset.likert").nth(2).getByRole("radio").nth(0)).toBeChecked();
    await expect(page.locator('fieldset[data-item="recall_notice"] input[value="not_sure"]')).toBeChecked();
    await expect(page.locator('fieldset[data-item="stop_reasons"] input[value="too_much_effort"]')).toBeChecked();
    await expect(page.locator('fieldset[data-item="stop_reasons"] input[value="other"]')).toBeChecked();
    await expect(page.locator("#open_influence")).toHaveValue("A draft answer, not yet submitted.");
    expect(await page.locator("#questionnaire-form input:checked").count()).toBe(5);
  };

  test("questionnaire answers survive the withdrawal dialog, a refresh, and the Back button", async ({ page }) => {
    await open(page, { condition: "advance" });
    await toVerification(page);
    await toQuestionnaire(page, "stop");
    await answerSome(page);

    // Open the dialog and cancel with the button, then with Escape.
    await page.getByRole("button", { name: "Withdraw from study" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "No, go back" }).click();
    await expectAnswers(page);
    await page.getByRole("button", { name: "Withdraw from study" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expectAnswers(page);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your experience" })).toBeVisible();
    await expectAnswers(page);

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your experience" })).toBeVisible();
    await expectAnswers(page);

    // Drafts are kept apart from the record: nothing has been submitted yet.
    const d = await drafts(page);
    expect(d.questionnaire.risk_exposure).toBe("4");
    expect(d.questionnaire.stop_reasons).toEqual(["too_much_effort", "other"]);
    let [r] = await records(page);
    expect(r.submission_status).toBe("in_progress");
    expect(r.q_risk_exposure).toBe("missing");
    expect(r.q_open_influence).toBe("missing");
    const session = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), SESSION_KEY);
    expect(session.questionnaire).toBeNull();

    // Submitting turns the draft into the response and removes the draft.
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
    [r] = await records(page);
    expect(r.q_risk_exposure).toBe("4");
    expect(r.q_risk_feel).toBe("1");
    expect(r.q_recall_notice).toBe("not_sure");
    expect(r.q_stop_reasons).toBe("too_much_effort;other");
    expect(r.q_open_influence).toBe("A draft answer, not yet submitted.");
    expect((await drafts(page)).questionnaire).toBeUndefined();
  });

  test("the eligibility and assent forms keep their state through a refresh", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "17", exact: true }).check();
    await page.getByRole("checkbox", { name: /approved Prosper-area/ }).check();
    await page.reload();
    await expect(page.getByRole("radio", { name: "17", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /approved Prosper-area/ })).toBeChecked();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("checkbox", { name: /agree to take part/ }).check();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /agree to take part/ })).toBeChecked();
    // Once answered, those drafts are gone.
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "A fictional platform" })).toBeVisible();
    expect(await drafts(page)).toEqual({});
  });

  test("an ineligible visitor's answers are not kept as a draft either", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "18 or older" }).check();
    expect((await drafts(page)).eligibility.ageCategory).toBe("over_17");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/only open to participants who meet/)).toBeVisible();
    expect(await drafts(page)).toEqual({});
  });

  test("drafts are cleared when another participant starts, and when someone withdraws", async ({ page }) => {
    await open(page, { condition: "later" });
    await toVerification(page);
    await toQuestionnaire(page, "stop");
    await answerSome(page);
    await page.getByRole("button", { name: "Withdraw from study" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(page.getByRole("heading", { name: "Withdrawn" })).toBeVisible();
    expect(await drafts(page)).toEqual({}); // unsent answers do not linger after a withdrawal
    const [w] = await records(page);
    expect(w.q_risk_exposure).toBe("withheld");

    // Next participant on the same device.
    await page.getByRole("button", { name: "Start a new session on this device" }).click();
    await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
    await toVerification(page);
    await toQuestionnaire(page, "stop");
    expect(await page.locator("#questionnaire-form input:checked").count()).toBe(0);
    await expect(page.locator("#open_influence")).toHaveValue("");

    // The same holds after a completed session.
    await page.locator("#open_influence").fill("Second participant.");
    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("button", { name: "Start a new session on this device" }).click();
    expect(await drafts(page)).toEqual({});
    expect((await records(page)).length).toBe(2);
  });
});

test("an accidentally selected answer can be cleared back to blank", async ({ page }) => {
  await open(page, { condition: "advance" });
  await toVerification(page);
  await toQuestionnaire(page, "stop");
  const item = page.locator('fieldset[data-item="risk_misuse"]');
  const clear = item.locator("[data-clear]");
  await expect(clear).toBeDisabled(); // nothing to clear yet
  await expect(clear).toBeHidden();
  const nextBefore = await page.locator('fieldset[data-item="risk_feel"]').boundingBox();
  await item.getByRole("radio").nth(4).check();
  await expect(clear).toBeVisible();
  await expect(clear).toHaveAccessibleName(/^Clear answer: I would be concerned/);
  const nextAfter = await page.locator('fieldset[data-item="risk_feel"]').boundingBox();
  expect(nextAfter.y).toBeCloseTo(nextBefore.y, 0); // its line was reserved; nothing jumped
  await clear.click();
  expect(await item.locator("input:checked").count()).toBe(0);
  await expect(clear).toBeHidden();
  expect((await drafts(page)).questionnaire.risk_misuse).toBeUndefined();

  // Single-choice questions get one too; checkbox questions do not need it.
  const recall = page.locator('fieldset[data-item="recall_notice"]');
  await recall.locator('input[value="yes"]').check();
  await recall.locator("[data-clear]").click();
  expect(await recall.locator("input:checked").count()).toBe(0);
  await expect(page.locator('fieldset[data-item="stop_reasons"] [data-clear]')).toHaveCount(0);

  // A cleared item is stored as skipped, and survives a refresh as blank.
  await page.locator('fieldset[data-item="risk_exposure"]').getByRole("radio").nth(1).check();
  await page.reload();
  expect(await item.locator("input:checked").count()).toBe(0);
  await page.getByRole("button", { name: "Submit answers" }).click();
  await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
  const [r] = await records(page);
  expect(r.q_risk_misuse).toBe("skipped");
  expect(r.q_recall_notice).toBe("skipped");
  expect(r.q_risk_exposure).toBe("2");
});

// ---------------------------------------------------------------------------
// 5. The withdrawal dialog

test("the withdrawal dialog keeps focus inside, makes the page behind inactive, and restores focus", async ({ page }) => {
  // A tall window, so the centered dialog does not sit on top of the buttons this test clicks behind it.
  await page.setViewportSize({ width: 1280, height: 2000 });
  await open(page, { condition: "later" });
  await toVerification(page);
  const dialog = page.locator("#withdraw-dialog");
  const link = page.locator("#withdraw-link");
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.matches(":modal"))).toBe(true);
  await expect(page.locator("#withdraw-cancel")).toBeFocused(); // the safe choice has focus first

  // Tab and Shift+Tab never reach anything behind the dialog.
  const inside = () =>
    page.evaluate(() => {
      const d = document.getElementById("withdraw-dialog");
      const a = document.activeElement;
      return d.contains(a) || a === document.body || a === document.documentElement;
    });
  const seen = new Set();
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await inside()).toBe(true);
    seen.add(await page.evaluate(() => document.activeElement.id));
  }
  expect(seen.has("withdraw-cancel")).toBe(true);
  expect(seen.has("withdraw-confirm")).toBe(true);
  expect(seen.has("verify-start")).toBe(false);
  expect(seen.has("verify-decline")).toBe(false);

  // The page behind does not respond while the dialog is open.
  const start = await page.locator("#verify-start").boundingBox();
  const box = await dialog.boundingBox();
  expect(start.y + start.height).toBeLessThan(box.y); // the button really is outside the dialog
  await page.mouse.click(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.click(10, 10); // clicking the dimmed area does not dismiss it either
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm your age group" })).toBeVisible();
  expect((await records(page))[0].initial_decision).toBe("not_reached");

  // Escape closes it and hands focus back to the control that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();

  // So does the cancel button.
  await page.keyboard.press("Enter");
  await expect(page.locator("#withdraw-cancel")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();

  // Confirming by keyboard withdraws and moves focus to the new screen's heading.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.locator("#withdraw-confirm")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Withdrawn" })).toBeFocused();
});

// ---------------------------------------------------------------------------
// 3. Milestones

test("the displayed verification screen and the ID prompt are saved as soon as they are reached", async ({ page }) => {
  await open(page, { condition: "later" });
  await toVerification(page);
  // No decision yet: someone who leaves here must still count as having seen the screen.
  await expect.poll(async () => (await records(page))[0].assigned_screen_displayed).toBe("yes");
  let [r] = await records(page);
  expect(r.initial_decision).toBe("not_reached");
  expect(r.final_pathway).toBe("incomplete_session");

  await startCheckToResult(page);
  await expect.poll(async () => (await records(page))[0].reached_id_prompt).toBe("yes");
  [r] = await records(page);
  expect(r.reached_uncertain_result).toBe("yes");
  expect(r.initial_decision).toBe("start");
  expect(r.id_decision).toBe("not_reached"); // reached the prompt, decided nothing: never a refusal
  expect(r.final_pathway).toBe("incomplete_session");
  expect(r.ms_simulation_duration).toBeGreaterThanOrEqual(2900);
  expect((await records(page)).length).toBe(1);
});

test("a storage failure is shown to the participant, and a retry saves the newest progress", async ({ page }) => {
  await open(page, { condition: "advance" });
  await toConsent(page);
  // From here on, this browser refuses to store records.
  await page.evaluate((key) => {
    const real = Storage.prototype.setItem;
    window.__allowStorage = false;
    Storage.prototype.setItem = function (k, v) {
      if (k === key && !window.__allowStorage) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, k, v);
    };
  }, DEMO_KEY);
  await page.getByRole("checkbox", { name: /agree to take part/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const notice = page.locator("#sync-status");
  await expect(notice).toContainText("Your progress has not reached the study's records yet.");
  await expect(notice).toContainText("refused to store the record");
  expect(await records(page)).toEqual([]);

  // The participant can keep going; the notice stays while saves keep failing.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your age group" })).toBeVisible();
  await page.getByRole("button", { name: "Decline verification" }).click();
  await expect(notice).toBeVisible();
  expect(await records(page)).toEqual([]);

  // Storage works again: one retry saves everything up to the newest step.
  await page.evaluate(() => {
    window.__allowStorage = true;
  });
  await notice.getByRole("button", { name: "Try saving again" }).click();
  await expect(notice).toBeHidden();
  const rs = await records(page);
  expect(rs.length).toBe(1);
  expect(rs[0].assigned_screen_displayed).toBe("yes");
  expect(rs[0].initial_decision).toBe("decline");
});

// ---------------------------------------------------------------------------
// 5. The two conditions on phones and with enlarged text

test.describe("the verification screen takes the same space in both conditions", () => {
  async function geometry(browser, { condition, width, scale }) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await open(page, { condition, spies: false });
    await toVerification(page);
    if (scale !== 1) await page.addStyleTag({ content: `html { font-size: ${scale * 100}% !important; }` });
    const g = await page.evaluate(() => {
      const box = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
      };
      const text = document.querySelector(".notice-text");
      return {
        start: box("#verify-start"),
        decline: box("#verify-decline"),
        slot: box(".notice-slot"),
        frame: box(".platform"),
        note: box(".study-note"),
        lineHeight: parseFloat(getComputedStyle(text).lineHeight),
        textHeight: text.getBoundingClientRect().height,
        visibility: getComputedStyle(text).visibility,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    const aria = await page.locator(".platform").ariaSnapshot();
    const visibleNotice = await page.getByText("you may be asked to provide a government-issued ID").isVisible();
    await context.close();
    return { ...g, aria, visibleNotice };
  }

  for (const [width, scale] of [
    [320, 1],
    [375, 1],
    [414, 1],
    [768, 1],
    [375, 1.5],
    [375, 2],
    [320, 2],
    [1000, 2],
  ]) {
    test(`at ${width}px wide with text at ${scale * 100}%`, async ({ browser }) => {
      const adv = await geometry(browser, { condition: "advance", width, scale });
      const later = await geometry(browser, { condition: "later", width, scale });
      for (const part of ["start", "decline", "slot", "frame", "note"]) {
        for (const side of ["x", "y", "w", "h"]) {
          expect(Math.abs(adv[part][side] - later[part][side]), `${part}.${side}`).toBeLessThanOrEqual(0.5);
        }
      }
      // The sentence really does take several lines on a phone, which is the case that used to differ.
      if (width <= 414) expect(adv.textHeight).toBeGreaterThan(adv.lineHeight * 2.5);
      expect(later.textHeight).toBeCloseTo(adv.textHeight, 0);
      // The later group cannot see it, and assistive technology is not told about it.
      expect(adv.visibility).toBe("visible");
      expect(adv.visibleNotice).toBe(true);
      expect(adv.aria).toContain("government-issued ID");
      expect(later.visibility).toBe("hidden");
      expect(later.visibleNotice).toBe(false);
      expect(later.aria).not.toContain("government-issued ID");
      expect(later.aria).not.toMatch(/ID/);
      // Nothing is cut off sideways, and both decisions stay the same size as each other.
      expect(adv.overflow).toBe(false);
      expect(later.overflow).toBe(false);
      expect(Math.abs(adv.start.h - adv.decline.h)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(adv.start.w - adv.decline.w)).toBeLessThanOrEqual(0.5);
    });
  }

  test("the hidden spacer cannot be reached by keyboard, selected, or found by reading the page text", async ({ page }) => {
    await open(page, { condition: "later" });
    await toVerification(page);
    expect(await page.evaluate(() => document.querySelector("#app").innerText)).not.toContain("government-issued ID");
    await page.keyboard.press("Control+A");
    expect(await page.evaluate(() => String(window.getSelection()))).not.toContain("government-issued ID");
    await expect(page.locator("#notice-sentence")).toHaveCount(0);
    expect(await page.getByText(NOTICE).count()).toBe(1); // present only as the spacer
  });
});

test("every screen fits a narrow phone with text enlarged to 200%", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "html { font-size: 200% !important; }";
      document.head.appendChild(s);
    });
  });
  const fits = async (label) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(o.sw, label).toBeLessThanOrEqual(o.iw + 1);
    // No button's label is clipped.
    const clipped = await page.evaluate(() => [...document.querySelectorAll("button:not([hidden])")].filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()));
    expect(clipped, label).toEqual([]);
  };
  await open(page, { condition: "advance", spies: false });
  await fits("intro");
  await toConsent(page);
  await fits("consent");
  await page.getByRole("checkbox", { name: /agree to take part/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await fits("scenario");
  await page.getByRole("button", { name: "Continue" }).click();
  await fits("verification");
  await page.getByRole("button", { name: "Withdraw from study" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const d = await page.locator("#withdraw-dialog").boundingBox();
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.x + d.width).toBeLessThanOrEqual(321);
  await page.getByRole("dialog").getByRole("button", { name: "No, go back" }).click();
  await startCheckToResult(page);
  await fits("result");
  await page.getByRole("button", { name: "I would stop here" }).click();
  await page.getByRole("button", { name: "Continue to the questions" }).click();
  await fits("questionnaire");
  await fillAndSubmitQuestionnaire(page);
  await fits("debrief");
  await context.close();
});

// ---------------------------------------------------------------------------
// 4. Configuration checks in the browser

test.describe("configuration checks", () => {
  test("a served configuration that fails its checks stops the app instead of running or falling back", async ({ page }) => {
    const bad = researchConfig("local-device");
    bad.consent.researcherContact = "";
    await page.route("**/study.config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(bad) }));
    await page.goto("/index.html?reset=1");
    await expect(page.getByRole("heading", { name: "This study page is not available right now" })).toBeVisible();
    await expect(page.getByText("Nothing has been recorded.")).toBeVisible();
    // Visitors to a deployed page are not shown setup details.
    await expect(page.getByText("Researcher contact")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    expect(await page.locator("#app").getAttribute("data-blocked")).toBe("true");
    expect(await records(page, RESEARCH_KEY)).toEqual([]);
    expect(await records(page, DEMO_KEY)).toEqual([]);
  });

  test("a valid served research configuration runs in research mode", async ({ page }) => {
    await page.route("**/study.config.json", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(researchConfig("local-device")) })
    );
    await page.goto("/index.html?reset=1");
    await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
    await expect(page.getByText("Research mode", { exact: true })).toBeVisible();
    expect(await page.locator("#app").getAttribute("data-config-source")).toBe("file");
  });

  test("a preview session left in a tab cannot continue as, or become, a research record", async ({ page }) => {
    await open(page, { condition: "advance" });
    await toVerification(page); // assent given in preview; a walkthrough record exists
    const before = await records(page, DEMO_KEY);
    expect(before.length).toBe(1);
    expect(before[0].record_kind).toBe("preview_walkthrough");

    // The researcher activates research mode in this browser. Same tab, same session storage.
    await page.evaluate(([k, cfg]) => localStorage.setItem(k, JSON.stringify(cfg)), ["agecheck.config.v1", researchConfig("local-device")]);
    await page.reload();
    await expect(page.getByText("Research mode", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible(); // a fresh start, not the old step
    expect(await records(page, RESEARCH_KEY)).toEqual([]);
    const session = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), SESSION_KEY);
    expect(session.mode).toBe("research");
    expect(session.assentGiven).toBe(false);
    expect(session.condition).toBeNull();

    // A real research session then produces a research record with a random condition.
    await toVerification(page);
    await toQuestionnaire(page, "decline");
    await fillAndSubmitQuestionnaire(page, { answerAll: false });
    const research = await records(page, RESEARCH_KEY);
    expect(research.length).toBe(1);
    expect(research[0].record_kind).toBe("research");
    expect(research[0].assignment_method).toBe("random");
    expect(research[0].response_id).not.toBe(before[0].response_id);
    const demo = await records(page, DEMO_KEY);
    expect(demo.length).toBe(1);
    expect(demo.every((r) => r.record_kind === "preview_walkthrough")).toBe(true);
  });

  test("a session does not carry over to a new study version", async ({ page }) => {
    await setLocalConfig(page, researchConfig("local-device"));
    await page.goto("/index.html?reset=1");
    await toVerification(page);
    await page.evaluate(([k, cfg]) => localStorage.setItem(k, JSON.stringify(cfg)), ["agecheck.config.v1", researchConfig("local-device", { studyVersion: "1.1.0" })]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
    expect(await page.locator("#app").getAttribute("data-study-version")).toBe("1.1.0");
  });
});

// ---------------------------------------------------------------------------
// 1, 4, 6. The researcher dashboard

test.describe("researcher dashboard", () => {
  test("checking requirements, a failed save, a tab switch, and a refresh all keep unsaved edits", async ({ page }) => {
    await page.goto("/researcher.html");
    await page.getByRole("tab", { name: "Configuration" }).click();
    await page.locator("#cfg-researcher").fill("Jordan Example, student researcher, jordan@example.test");
    await page.locator("#cfg-duration").fill("About 5 minutes");
    await page.locator("#cfg-version").fill("1.0.0");
    await page.locator("#cfg-retain").selectOption("false");
    await expect(page.locator("#unsaved-badge")).toBeVisible();
    const expectEdits = async () => {
      await expect(page.locator("#cfg-researcher")).toHaveValue("Jordan Example, student researcher, jordan@example.test");
      await expect(page.locator("#cfg-duration")).toHaveValue("About 5 minutes");
      await expect(page.locator("#cfg-version")).toHaveValue("1.0.0");
      await expect(page.locator("#cfg-retain")).toHaveValue("false");
      await expect(page.locator("#unsaved-badge")).toBeVisible();
    };

    await page.locator("#cfg-check").click();
    await expect(page.locator("#config-problems")).toContainText("Not ready for activation");
    await expect(page.locator("#config-problems")).toContainText("Supervisor or teacher contact still contains placeholder text");
    await expect(page.locator("#config-problems")).not.toContainText("Researcher contact"); // the typed value was the one checked
    await expectEdits();

    // Activation is refused for the same reasons, and still nothing typed is lost.
    await page.locator("#cfg-activate").click();
    await expect(page.locator("#config-problems")).toContainText("Not activated");
    await expectEdits();

    // A save that fails validation keeps the form too.
    await page.locator("#cfg-minAge").fill("30");
    await page.getByRole("button", { name: "Save to this browser" }).click();
    await expect(page.locator("#config-problems")).toContainText("Not saved");
    await expect(page.locator("#config-problems")).toContainText("age range");
    await expect(page.locator("#cfg-minAge")).toHaveValue("30");
    await expectEdits();
    expect(await page.evaluate(() => localStorage.getItem("agecheck.config.v1"))).toBeNull(); // nothing invalid was saved

    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Configuration" }).click();
    await expectEdits();
    await page.reload();
    await page.getByRole("tab", { name: "Configuration" }).click();
    await expectEdits();

    // Fixing the problem and saving clears the unsaved marker.
    await page.locator("#cfg-minAge").fill("16");
    await page.getByRole("button", { name: "Save to this browser" }).click();
    await expect(page.locator("#config-message")).toContainText("Saved to this browser");
    await expect(page.locator("#unsaved-badge")).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("agecheck.config.v1")));
    expect(saved.consent.duration).toBe("About 5 minutes");
    expect(saved.mode).toBe("preview");
  });

  test("research mode cannot be activated with required study information emptied", async ({ page }) => {
    const ready = researchConfig("local-device");
    ready.mode = "preview";
    ready.frozen = false;
    await setLocalConfig(page, ready);
    await page.goto("/researcher.html");
    await page.getByRole("tab", { name: "Configuration" }).click();
    await page.locator("#cfg-check").click();
    await expect(page.locator("#config-problems")).toContainText("All activation requirements are met.");

    for (const [field, label] of [
      ["#cfg-researcher", "Researcher contact"],
      ["#cfg-storage-text", "Data storage, access, and retention"],
      ["#cfg-withdrawal-text", "Withdrawal procedure"],
    ]) {
      const original = await page.locator(field).inputValue();
      await page.locator(field).fill("   ");
      await page.locator("#cfg-activate").click();
      await expect(page.locator("#config-problems")).toContainText(`${label} is required and is empty`);
      await page.locator(field).fill(original);
    }
    await page.locator("#cfg-retain").selectOption("");
    await page.locator("#cfg-activate").click();
    await expect(page.locator("#config-problems")).toContainText("Withdrawal policy must be chosen");
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("agecheck.config.v1"))).mode).toBe("preview");

    // With everything in place it activates, freezes, and the participant app follows.
    await page.locator("#cfg-retain").selectOption("false");
    page.once("dialog", (d) => d.accept());
    await page.locator("#cfg-activate").click();
    await expect(page.locator("#config-message")).toContainText("Research mode activated");
    await expect(page.locator("#cfg-researcher")).toBeDisabled();
    await page.goto("/index.html?reset=1");
    await expect(page.getByText("Research mode", { exact: true })).toBeVisible();
  });

  test("an imported configuration is validated, and a research one that fails its checks comes in as preview", async ({ page }) => {
    await page.goto("/researcher.html");
    await page.getByRole("tab", { name: "Configuration" }).click();

    await page.locator("#cfg-import").fill("{ not json");
    await page.locator("#cfg-import-btn").click();
    await expect(page.locator("#config-problems")).toContainText("not valid JSON");

    const broken = researchConfig("local-device");
    broken.questionnaire.items = broken.questionnaire.items.slice(0, 3);
    await page.locator("#cfg-import").fill(JSON.stringify(broken));
    await page.locator("#cfg-import-btn").click();
    await expect(page.locator("#config-problems")).toContainText("Not imported");
    await expect(page.locator("#config-problems")).toContainText("questionnaire.items");
    expect(await page.evaluate(() => localStorage.getItem("agecheck.config.v1"))).toBeNull();

    const emptied = researchConfig("local-device");
    emptied.consent.supervisorContact = "";
    await page.locator("#cfg-import").fill(JSON.stringify(emptied));
    await page.locator("#cfg-import-btn").click();
    await expect(page.locator("#config-problems")).toContainText("Imported in preview mode");
    await expect(page.locator("#config-problems")).toContainText("Supervisor or teacher contact is required and is empty");
    let saved = JSON.parse(await page.evaluate(() => localStorage.getItem("agecheck.config.v1")));
    expect(saved.mode).toBe("preview");
    expect(saved.frozen).toBe(false);

    await page.locator("#cfg-import").fill(JSON.stringify(researchConfig("local-device")));
    await page.locator("#cfg-import-btn").click();
    await expect(page.locator("#config-message")).toContainText("Imported and saved");
    saved = JSON.parse(await page.evaluate(() => localStorage.getItem("agecheck.config.v1")));
    expect(saved.mode).toBe("research");
  });

  test("the 'excluding withdrawn' rate uses the same records for numerator and denominator, and empty groups say so", async ({ page }) => {
    // Policy "keep partial responses": the withdrawn record still says id_decision = continue.
    const cfg = cloneConfig(DEFAULT_STUDY_CONFIG);
    cfg.withdrawal.retainPartialResponses = true;
    const make = (route, { withdraw = false } = {}) => {
      const s = E.createSession(cfg);
      E.begin(s);
      E.submitEligibility(s, cfg, { ageCategory: "age_16", meetsCriteria: true });
      E.giveAssent(s, cfg, { forcedCondition: "advance_notice" });
      E.continueScenario(s);
      E.confirmVerificationDisplayed(s);
      E.initialDecision(s, "start");
      E.simulationComplete(s);
      E.idDecision(s, route);
      E.beginQuestionnaire(s);
      E.submitQuestionnaire(s, { risk_exposure: "3" });
      if (withdraw) E.withdraw(s);
      else E.markSubmitted(s);
      return E.buildRecord(s, cfg);
    };
    const recs = [make("continue"), make("stop"), make("continue", { withdraw: true })];
    expect(recs[2].id_decision).toBe("continue");
    await page.goto("/researcher.html");
    await page.evaluate(([k, list]) => localStorage.setItem(k, JSON.stringify(Object.fromEntries(list.map((r) => [r.response_id, r])))), [DEMO_KEY, recs]);
    await page.locator("#refresh-btn").click();
    await expect(page.locator("#scope-line")).toContainText("Showing 3 of 3 demo records");

    const row = (id) => page.locator(`#outcome-table tr[data-rate="${id}"] td`);
    await expect(row("excluding-withdrawn").nth(1)).toHaveText("1 / 2 (50.0%)"); // was "2 / 2 (100.0%)"
    await expect(row("assigned").nth(1)).toHaveText("1 / 3 (33.3%)");
    await expect(row("reached").nth(1)).toHaveText("1 / 2 (50.0%)");
    // The later-notice group has no records at all.
    for (const id of ["assigned", "excluding-withdrawn", "started", "reached"]) await expect(row(id).nth(2)).toHaveText("no records");
    const stage = (label) => page.locator("#stage-table tr", { hasText: label }).locator("td");
    await expect(stage("Would continue with ID verification").nth(1)).toHaveText("1");
    await expect(stage("Withdrawn from study").nth(1)).toHaveText("1");
    await expect(stage("Not withdrawn").nth(1)).toHaveText("2");
  });

  test("refresh, filters, and export scope", async ({ page, context }) => {
    await page.goto("/researcher.html");
    await page.getByRole("tab", { name: "Demo data" }).click();
    await page.locator("#demo-count").fill("30");
    await page.getByRole("button", { name: "Generate (replace demo set)" }).click();
    await expect(page.getByText("Generated 30 synthetic demo records.")).toBeVisible();
    const all = await records(page);
    expect(all.length).toBe(30);
    expect(all.every((r) => r.record_kind === "synthetic_demo")).toBe(true);
    expect(await records(page, RESEARCH_KEY)).toEqual([]);

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.locator("#scope-line")).toHaveText("Showing 30 of 30 demo records (no filters).");
    await expect(page.locator("#pathway-table tbody tr").last().locator("th").last()).toHaveText("30");
    await expect(page.getByText("Research data (research mode not active)")).toBeDisabled();

    // Refresh: a participant finishes in another tab, and the dashboard picks it up on request.
    const other = await context.newPage();
    await open(other, { condition: "later", spies: false });
    await toVerification(other);
    await toQuestionnaire(other, "continue");
    await fillAndSubmitQuestionnaire(other, { answerAll: false });
    await other.close();
    await expect(page.locator("#scope-line")).toContainText("Showing 30 of 30"); // not yet
    await page.getByRole("button", { name: "Refresh records" }).click();
    await expect(page.locator("#scope-line")).toHaveText("Showing 31 of 31 demo records (no filters).");

    // Filters narrow the counts, the table, and the export together.
    const count = (test) => all.filter(test).length;
    const later = count((r) => r.condition === "later_notice") + 1;
    await page.locator("#filter-condition").selectOption("later_notice");
    await expect(page.locator("#scope-line")).toHaveText(`Showing ${later} of 31 demo records (condition: Later notice).`);
    await expect(page.locator("#pathway-table tbody tr").last().locator("th").nth(1)).toHaveText("0"); // advance notice filtered out
    await page.locator("#filter-status").selectOption("withdrawn");
    const laterWithdrawn = count((r) => r.condition === "later_notice" && r.submission_status === "withdrawn");
    await expect(page.locator("#scope-line")).toContainText(`Showing ${laterWithdrawn} of 31`);
    await expect(page.locator("#scope-line")).toContainText("condition: Later notice; status: Withdrawn");
    await page.getByRole("tab", { name: "Records" }).click();
    await expect(page.locator("#records-table tbody tr")).toHaveCount(laterWithdrawn);
    await expect(page.locator("#filter-condition")).toHaveValue("later_notice"); // filters persist across tabs
    await page.locator("#filter-status").selectOption("");
    await page.locator("#filter-pathway").selectOption("would_continue_with_id");
    const laterContinue = count((r) => r.condition === "later_notice" && r.final_pathway === "would_continue_with_id") + 1;
    await expect(page.locator("#records-table tbody tr")).toHaveCount(laterContinue);
    await expect(page.locator("#filter-version option")).toHaveCount(2); // any + the one version present

    // Export says exactly what it contains, and offers the unfiltered set separately.
    await page.getByRole("tab", { name: "Export" }).click();
    await expect(page.locator("#export-scope")).toContainText("demo data only");
    await expect(page.locator("#export-scope")).toContainText(`${laterContinue} of 31`);
    await expect(page.locator("#export-scope")).toContainText("filtered: condition: Later notice; pathway: Started check and would continue with ID");
    const [filtered] = await Promise.all([page.waitForEvent("download"), page.locator("#export-csv").click()]);
    expect(filtered.suggestedFilename()).toBe("agecheck-demo-filtered-v1.0.0-draft.csv");
    const filteredRows = fs.readFileSync(await filtered.path(), "utf8").trim().split("\r\n");
    expect(filteredRows.length).toBe(laterContinue + 1);
    expect(filteredRows.slice(1).every((line) => line.includes("later_notice") && line.includes("would_continue_with_id"))).toBe(true);
    const [everything] = await Promise.all([page.waitForEvent("download"), page.locator("#export-csv-all").click()]);
    expect(everything.suggestedFilename()).toBe("agecheck-demo-all-v1.0.0-draft.csv");
    expect(fs.readFileSync(await everything.path(), "utf8").trim().split("\r\n").length).toBe(32);
    const [json] = await Promise.all([page.waitForEvent("download"), page.locator("#export-json").click()]);
    expect(json.suggestedFilename()).toBe("agecheck-demo-filtered-v1.0.0-draft.json");
    const parsed = JSON.parse(fs.readFileSync(await json.path(), "utf8"));
    expect(parsed.data_kind).toBe("demo");
    expect(parsed.scope).toBe("filtered");
    expect(parsed.filters.condition).toBe("later_notice");
    expect(parsed.count).toBe(laterContinue);
    expect(parsed.total_in_source).toBe(31);
    expect(parsed.records.every((r) => r.record_kind !== "research")).toBe(true);

    // Clearing the filters returns to the whole set, with a single unambiguous export button.
    await page.locator("#filters-clear").click();
    await expect(page.locator("#scope-line")).toHaveText("Showing 31 of 31 demo records (no filters).");
    await expect(page.locator("#export-csv-all")).toHaveCount(0);
    await expect(page.locator("#export-csv")).toHaveText("Download CSV: all 31 records");

    // The data dictionary and deletion by code still work.
    await page.getByRole("tab", { name: "Data dictionary" }).click();
    await expect(page.getByRole("cell", { name: "final_pathway" })).toBeVisible();
    await page.getByRole("tab", { name: "Records" }).click();
    const code = (await page.locator("#records-table tbody tr").first().locator("td").first().textContent()).trim();
    await page.getByRole("tab", { name: "Delete by code" }).click();
    await page.locator("#delete-code").fill(code);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(`Deleted 1 record(s) with code ${code}.`)).toBeVisible();
    expect((await records(page)).length).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 2, 3. Saving against a real server: slow, failed, and overlapping requests

test.describe("saving to the research server", () => {
  test.beforeEach(async ({ request }) => {
    await researchServer(request).deploy(researchConfig("remote-endpoint"));
  });

  const openResearch = async (page) => {
    await page.goto(`${RESEARCH_URL}/index.html?reset=1`);
    await expect(page.getByText("Research mode", { exact: true })).toBeVisible();
  };

  /** Watches every save and lets a test hold or fail the ones it chooses. */
  async function intercept(page, decide) {
    const seen = [];
    await page.route("**/api/submit", async (route) => {
      const body = route.request().postDataJSON();
      seen.push(body);
      const action = await decide(body, seen.length);
      if (action === "fail") await route.abort("failed");
      else await route.continue();
    });
    return seen;
  }

  test("milestones reach the server as they happen, with one record", async ({ page, request }) => {
    const server = researchServer(request);
    await openResearch(page);
    await toVerification(page);
    await expect.poll(async () => (await server.records())[0]?.assigned_screen_displayed).toBe("yes");
    expect((await server.records())[0].initial_decision).toBe("not_reached");
    await startCheckToResult(page);
    await expect.poll(async () => (await server.records())[0].reached_id_prompt).toBe("yes");
    expect((await server.records())[0].id_decision).toBe("not_reached");
    await page.getByRole("button", { name: "I would continue with ID verification" }).click();
    await page.getByRole("button", { name: "Continue to the questions" }).click();
    await fillAndSubmitQuestionnaire(page);
    const all = await server.records();
    expect(all.length).toBe(1);
    expect(all[0].record_kind).toBe("research");
    expect(all[0].submission_status).toBe("submitted");
    expect(all[0].final_pathway).toBe("would_continue_with_id");
  });

  test("withdrawing while a submission is still being saved ends participation at once and withdraws the record", async ({ page, request }) => {
    const server = researchServer(request);
    let release;
    const held = new Promise((r) => (release = r));
    const seen = await intercept(page, async (body) => {
      if (body.submission_status === "submitted") await held; // the submission hangs in flight
      return "continue";
    });
    await openResearch(page);
    await toVerification(page);
    await toQuestionnaire(page, "continue");
    await page.locator("fieldset.likert").first().getByRole("radio").nth(4).check();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.locator("#submit-btn")).toBeDisabled();
    await expect.poll(() => seen.some((b) => b.submission_status === "submitted")).toBe(true);

    await page.getByRole("button", { name: "Withdraw from study" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, withdraw" }).click();
    // Participation ends immediately, and the screen says the save is still on its way.
    await expect(page.getByRole("heading", { name: "Withdrawn" })).toBeVisible();
    await expect(page.locator("#withdrawal-state")).toHaveAttribute("data-state", "pending");
    await expect(page.getByText("Saving your withdrawal")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a new session on this device" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Withdraw from study" })).toHaveCount(0);

    release(); // the submission lands first, then the withdrawal follows it
    await expect(page.locator("#withdrawal-state")).toHaveAttribute("data-state", "saved");
    await expect(page.getByText("Your withdrawal has been saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Withdrawn" })).toBeVisible(); // the late submission did not bring back the debrief
    await expect(page.getByRole("button", { name: "Start a new session on this device" })).toBeVisible();

    const all = await server.records();
    expect(all.length).toBe(1);
    expect(all[0].submission_status).toBe("withdrawn");
    expect(all[0].final_pathway).toBe("withdrawn");
    expect(all[0].withdrawn_at_step).toBe("questionnaire");
    expect(all[0].q_risk_exposure).toBe("withheld"); // the deployed policy withholds responses
    expect(all[0].id_decision).toBe("withheld");
    expect(seen.map((b) => b.submission_status).slice(-2)).toEqual(["submitted", "withdrawn"]);
  });

  test("a withdrawal that cannot be saved is shown as not saved, and can be retried", async ({ page, request }) => {
    const server = researchServer(request);
    let failing = true;
    await intercept(page, (body) => (failing && body.submission_status === "withdrawn" ? "fail" : "continue"));
    await openResearch(page);
    await toVerification(page);
    await startCheckToResult(page);
    await page.getByRole("button", { name: "Withdraw from study" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(page.getByRole("heading", { name: "Withdrawn" })).toBeVisible();
    const state = page.locator("#withdrawal-state");
    await expect(state).toHaveAttribute("data-state", "failed");
    await expect(state).toContainText("Your withdrawal has not reached the study's records yet.");
    await expect(state).toContainText("could not be reached");
    await expect(state).toContainText("You are no longer taking part");
    await expect(page.getByText("Your withdrawal has been saved.")).toHaveCount(0);
    await expect(page.locator("#withdrawn-code")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(page.getByRole("button", { name: "Start a new session on this device" })).toBeHidden();
    expect((await server.records())[0].submission_status).toBe("in_progress"); // the server does not know yet

    // Still failing after a reload: the page tries again by itself and says so honestly.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Withdrawn" })).toBeVisible();
    await expect(state).toHaveAttribute("data-state", "failed");

    failing = false;
    await state.getByRole("button", { name: "Try saving again" }).click();
    await expect(state).toHaveAttribute("data-state", "saved");
    await expect(page.getByRole("button", { name: "Start a new session on this device" })).toBeVisible();
    const all = await server.records();
    expect(all.length).toBe(1);
    expect(all[0].submission_status).toBe("withdrawn");
    expect(all[0].withdrawn_at_step).toBe("result");
  });

  test("a withdrawal left unsaved when the page closes is saved when the page is opened again", async ({ page, request }) => {
    const server = researchServer(request);
    let failing = true;
    await intercept(page, (body) => (failing && body.submission_status === "withdrawn" ? "fail" : "continue"));
    await openResearch(page);
    await toVerification(page);
    await page.getByRole("button", { name: "Withdraw from study" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(page.locator("#withdrawal-state")).toHaveAttribute("data-state", "failed");
    failing = false;
    await page.reload();
    await expect(page.locator("#withdrawal-state")).toHaveAttribute("data-state", "saved");
    expect((await server.records())[0].submission_status).toBe("withdrawn");
  });

  test("failed progress saves are shown, and the next save carries the newest progress with no duplicate", async ({ page, request }) => {
    const server = researchServer(request);
    let failing = true;
    const seen = await intercept(page, () => (failing ? "fail" : "continue"));
    await openResearch(page);
    await toVerification(page);
    const notice = page.locator("#sync-status");
    await expect(notice).toContainText("Your progress has not reached the study's records yet.");
    await expect(notice).toContainText("could not be reached");
    expect(await server.records()).toEqual([]);

    // The connection comes back. The next milestone's save succeeds and the notice goes away.
    failing = false;
    await startCheckToResult(page);
    await expect(notice).toBeHidden();
    const all = await server.records();
    expect(all.length).toBe(1);
    expect(all[0].assigned_screen_displayed).toBe("yes");
    expect(all[0].initial_decision).toBe("start");
    expect(all[0].reached_id_prompt).toBe("yes");
    expect(seen.length).toBeGreaterThanOrEqual(4);
  });

  test("a slow save is never overtaken by an older one: saves go out one at a time, newest state last", async ({ page, request }) => {
    const server = researchServer(request);
    let release;
    const held = new Promise((r) => (release = r));
    const rank = (b) => (b.id_decision !== "not_reached" ? 4 : b.reached_id_prompt === "yes" ? 3 : b.initial_decision !== "not_reached" ? 2 : b.assigned_screen_displayed === "yes" ? 1 : 0);
    let inFlight = 0;
    let maxInFlight = 0;
    const order = [];
    await page.route("**/api/submit", async (route) => {
      const body = route.request().postDataJSON();
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (order.length === 0) await held; // the very first save is slow
      order.push(rank(body));
      await route.continue();
      inFlight -= 1;
    });
    await openResearch(page);
    await toVerification(page);
    await page.getByRole("button", { name: "Start simulated check" }).click();
    await expect(page.getByRole("heading", { name: /could not confidently confirm/ })).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "I would stop here" }).click();
    expect(await server.records()).toEqual([]); // everything is queued behind the slow first save
    release();
    await expect.poll(async () => (await server.records())[0]?.id_decision).toBe("stop");
    expect(maxInFlight).toBe(1);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // never an older state after a newer one
    expect(order[order.length - 1]).toBe(4);
    expect((await server.records()).length).toBe(1);
  });

  test("a submission that fails on the server's side is reported, and the retry is one record", async ({ page, request }) => {
    const server = researchServer(request);
    let failing = true;
    await intercept(page, (body) => (failing && body.submission_status === "submitted" ? "fail" : "continue"));
    await openResearch(page);
    await toVerification(page);
    await toQuestionnaire(page, "decline");
    await page.locator("fieldset.likert").first().getByRole("radio").nth(1).check();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.locator("#questionnaire-form").getByRole("alert")).toContainText("Your answers were not submitted.");
    expect((await server.records())[0].submission_status).toBe("in_progress");
    failing = false;
    // The participant changes an answer before retrying; the retry sends the answers as they stand now.
    await page.locator("fieldset.likert").first().getByRole("radio").nth(3).check();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "About this study" })).toBeVisible();
    const all = await server.records();
    expect(all.length).toBe(1);
    expect(all[0].submission_status).toBe("submitted");
    expect(all[0].q_risk_exposure).toBe("4");
  });

  test("the research server refuses records while no valid research configuration is deployed", async ({ page, request }) => {
    const server = researchServer(request);
    await server.clear();
    // Replace the deployed configuration with a preview one: collection must close.
    const res = await request.put(`${RESEARCH_URL}/api/admin/config`, {
      headers: { Authorization: "Bearer e2e-only-admin-token-0123456789" },
      data: cloneConfig(DEFAULT_STUDY_CONFIG),
    });
    expect(res.status()).toBe(200);
    const direct = await request.post(`${RESEARCH_URL}/api/submit`, {
      headers: { "X-Study-Token": "e2e-only-submit-token-0123456789" },
      data: { any: "thing" },
    });
    expect(direct.status()).toBe(503);
    // And the page served there is back in preview mode, collecting nothing.
    await page.goto(`${RESEARCH_URL}/index.html?reset=1`);
    await expect(page.getByText("Preview mode: no research data is collected")).toBeVisible();
    expect(await server.records()).toEqual([]);
  });
});
