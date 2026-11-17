// AgeCheck Study: participant interface.
//
// Renders one step at a time from the session state (src/engine.js) and
// persists the session in sessionStorage so a refresh or back navigation
// returns to the same step with the same condition. Unfinished answers are
// kept separately as drafts (also in this tab's sessionStorage) so a refresh,
// the Back button, or a dialog cannot lose them. Records are written through
// the store chosen by the active configuration (src/storage.js), one save at
// a time, at every milestone.
//
// This file never requests camera or microphone access, never creates an
// upload field, and never reads anything from the device beyond its own
// browser storage.

import * as E from "./engine.js";
import { ageCategories } from "./study-config.js";
import {
  resolveConfig,
  participantStore,
  loadSessionJson,
  saveSessionJson,
  clearSession,
  loadDrafts,
  saveDrafts,
  clearDrafts,
} from "./storage.js";

const root = document.getElementById("app");
const headerRight = document.getElementById("header-right");
const syncBox = document.getElementById("sync-status");
const dialog = document.getElementById("withdraw-dialog");

let config = null;
let configSource = "default";
let store = null;
let session = null;
let drafts = {};
let simulationTimer = null;
let saveChain = Promise.resolve();
let sync = { state: "idle", error: null };
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Helpers

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(text) {
  return String(text ?? "")
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function messageOf(err) {
  return err && err.message ? err.message : "The save did not go through.";
}

function persist() {
  saveSessionJson(E.serializeSession(session));
}

function isPreview() {
  return config.mode !== "research";
}

function forcedConditionFromUrl() {
  if (!isPreview()) return null;
  const v = (params.get("condition") || "").toLowerCase();
  if (v === "advance" || v === "advance_notice") return E.CONDITION.ADVANCE;
  if (v === "later" || v === "later_notice") return E.CONDITION.LATER;
  return null;
}

function focusHeading() {
  const h = root.querySelector("h1, h2");
  if (h) {
    h.setAttribute("tabindex", "-1");
    h.focus({ preventScroll: false });
  }
  window.scrollTo({ top: 0 });
}

function keepHistoryOnPage() {
  // After assent, keep the browser's Back button from leaving the study. The
  // step and condition live in the session, so Back cannot change either.
  if (E.hasRecord(session) && !(history.state && history.state.agecheck)) {
    history.pushState({ agecheck: true }, "");
  }
}

function startFreshSession() {
  clearSession();
  clearDrafts();
  drafts = {};
  session = E.createSession(config);
  sync = { state: "idle", error: null };
}

// ---------------------------------------------------------------------------
// Saving. One save at a time, always of the record as it stands when the save
// actually runs, so a slow or failed request can never be followed by an older
// one. The stores apply the same ordering to anything that still arrives late.

function enqueueSave() {
  const run = saveChain.then(async () => {
    if (!store || !E.hasRecord(session)) return { ok: true, outcome: "skipped" };
    return store.save(E.buildRecord(session, config));
  });
  saveChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/** Save progress at a milestone. A failure is shown to the participant, never hidden, and the next save retries. */
async function saveMilestone() {
  if (!store || !E.hasRecord(session)) return;
  try {
    await enqueueSave();
    if (sync.state === "failed") setSync("idle");
  } catch (err) {
    if (session.step !== "withdrawn" && session.submission.status !== "submitted") setSync("failed", messageOf(err));
  }
}

function setSync(state, error = null) {
  sync = { state, error };
  renderSync();
}

function renderSync() {
  const show = sync.state === "failed" && session && E.hasRecord(session) && session.step !== "withdrawn";
  if (!show) {
    syncBox.hidden = true;
    syncBox.innerHTML = "";
    return;
  }
  syncBox.hidden = false;
  syncBox.innerHTML = `
    <div class="notice-box danger" role="alert">
      <p class="tight"><strong>Your progress has not reached the study's records yet.</strong> ${esc(sync.error)}</p>
      <p class="small tight">It is still safe on this page, and it will be sent again at the next step. You can keep going.</p>
      <div class="actions"><button type="button" class="btn btn-secondary" id="sync-retry">Try saving again</button></div>
    </div>`;
  syncBox.querySelector("#sync-retry").addEventListener("click", () => saveMilestone());
}

// ---------------------------------------------------------------------------
// Drafts: unfinished answers, kept apart from the session and from any record.

function storeDrafts() {
  saveDrafts(drafts);
}

function readAnswers(form) {
  const data = new FormData(form);
  const answers = {};
  for (const [key, value] of data.entries()) {
    if (key === "stop_reasons") {
      (answers.stop_reasons ||= []).push(String(value));
    } else {
      answers[key] = String(value);
    }
  }
  return answers;
}

function captureDraft(form) {
  if (!form) return;
  if (form.id === "questionnaire-form") {
    drafts.questionnaire = readAnswers(form);
    updateClearButtons(form);
  } else if (form.id === "eligibility-form") {
    const age = form.querySelector('input[name="ageCategory"]:checked');
    const code = form.querySelector('input[name="recruitmentCode"]');
    drafts.eligibility = {
      ageCategory: age ? age.value : "",
      meetsCriteria: form.querySelector('input[name="meetsCriteria"]').checked,
      recruitmentCode: code ? code.value : "",
    };
  } else if (form.id === "consent-form") {
    drafts.consent = { assent: form.querySelector('input[name="assent"]').checked };
  } else {
    return;
  }
  storeDrafts();
}

function dropDraft(name) {
  if (drafts[name] === undefined) return;
  delete drafts[name];
  storeDrafts();
}

function applyAnswers(form, answers) {
  for (const [key, value] of Object.entries(answers || {})) {
    if (Array.isArray(value)) {
      for (const v of value) {
        const box = form.querySelector(`input[name="${CSS.escape(key)}"][value="${CSS.escape(v)}"]`);
        if (box) box.checked = true;
      }
    } else {
      const radio = form.querySelector(`input[name="${CSS.escape(key)}"][value="${CSS.escape(value)}"]`);
      if (radio) radio.checked = true;
      const ta = form.querySelector(`textarea[name="${CSS.escape(key)}"]`);
      if (ta) ta.value = value;
    }
  }
}

function updateClearButtons(form) {
  for (const btn of form.querySelectorAll("[data-clear]")) {
    btn.disabled = !form.querySelector(`input[name="${CSS.escape(btn.dataset.clear)}"]:checked`);
  }
}

// ---------------------------------------------------------------------------
// Header and the withdrawal dialog

function renderHeader() {
  const parts = [];
  if (isPreview()) {
    parts.push(`<span class="badge badge-preview">Preview mode: no research data is collected</span>`);
  } else {
    parts.push(`<span class="badge badge-research">Research mode</span>`);
  }
  if (E.canWithdraw(session)) {
    parts.push(`<button type="button" class="link-btn" id="withdraw-link">${esc(config.withdrawal.linkLabel)}</button>`);
  }
  headerRight.innerHTML = parts.join("");
  const w = headerRight.querySelector("#withdraw-link");
  if (w) w.addEventListener("click", openWithdrawDialog);
}

function setupDialog() {
  const w = config.withdrawal;
  dialog.querySelector("#withdraw-title").textContent = w.heading;
  dialog.querySelector("#withdraw-body").innerHTML = paragraphs(w.body);
  const cancel = dialog.querySelector("#withdraw-cancel");
  const confirm = dialog.querySelector("#withdraw-confirm");
  cancel.textContent = w.cancelLabel;
  confirm.textContent = w.confirmLabel;
  cancel.addEventListener("click", () => dialog.close("cancel"));
  confirm.addEventListener("click", () => {
    dialog.close("confirm");
    confirmWithdraw();
  });
  // Closing without confirming (the button, or Escape) hands focus back to
  // the control that opened the dialog. Nothing on the page was re-rendered,
  // so everything the participant had entered is exactly as they left it.
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "confirm") return;
    const opener = document.getElementById("withdraw-link");
    if (opener) opener.focus();
    else focusHeading();
  });
}

function openWithdrawDialog() {
  if (!E.canWithdraw(session) || dialog.open) return;
  if (typeof dialog.showModal !== "function") {
    // Very old browsers: fall back to the browser's own confirmation box.
    if (window.confirm(`${config.withdrawal.heading}\n\n${config.withdrawal.body}`)) confirmWithdraw();
    return;
  }
  dialog.returnValue = "";
  dialog.showModal(); // modal: the page behind is inert and focus cannot leave
  dialog.querySelector("#withdraw-cancel").focus();
}

/** Withdrawal ends participation at once. Saving it is tracked separately and can be retried. */
async function confirmWithdraw() {
  if (!E.canWithdraw(session)) return;
  E.withdraw(session);
  drafts = {};
  clearDrafts();
  sync = { state: "idle", error: null };
  persist();
  render();
  await saveWithdrawal();
}

async function saveWithdrawal() {
  if (session.step !== "withdrawn") return;
  E.markWithdrawalPending(session);
  persist();
  renderWithdrawalStatus();
  try {
    if (!store) throw new Error("No storage is configured.");
    await enqueueSave();
    E.markWithdrawalSaved(session);
  } catch (err) {
    E.markWithdrawalFailed(session, messageOf(err));
  }
  persist();
  renderWithdrawalStatus();
}

function withdrawalStatusHtml() {
  if (session.withdrawalSync === "saved") {
    return `<p class="notice-box" id="withdrawal-state" data-state="saved"><strong>Your withdrawal has been saved.</strong></p>`;
  }
  if (session.withdrawalSync === "failed") {
    return `
      <div class="notice-box danger" id="withdrawal-state" data-state="failed" role="alert">
        <p class="tight"><strong>Your withdrawal has not reached the study's records yet.</strong> ${esc(session.withdrawalError)}</p>
        <p class="small tight">You are no longer taking part, and nothing more is being collected. Keep this page open and try again. If it keeps failing, give the researcher your response code so the record can be removed by hand.</p>
        <div class="actions"><button type="button" class="btn" id="withdrawal-retry">Try saving again</button></div>
      </div>`;
  }
  return `<p class="notice-box warn" id="withdrawal-state" data-state="pending">Saving your withdrawal to the study's records. Keep this page open for a moment.</p>`;
}

function renderWithdrawalStatus() {
  const box = root.querySelector("#withdrawal-status");
  if (!box || session.step !== "withdrawn") return;
  box.innerHTML = withdrawalStatusHtml();
  const retry = box.querySelector("#withdrawal-retry");
  if (retry) retry.addEventListener("click", () => saveWithdrawal());
  const actions = root.querySelector("#withdrawn-actions");
  if (actions) actions.hidden = session.withdrawalSync !== "saved";
}

// ---------------------------------------------------------------------------
// Views

function viewIntro() {
  const c = config.intro;
  return `
    <section class="card">
      <h1>${esc(c.heading)}</h1>
      ${paragraphs(c.body)}
      <p class="muted small">This app does not use your camera or microphone and has no way to upload files.</p>
      <div class="actions"><button type="button" class="btn" id="intro-continue">${esc(c.continueLabel)}</button></div>
    </section>`;
}

function viewEligibility() {
  const cats = ageCategories(config);
  const rc = config.eligibility.recruitmentCode;
  return `
    <section class="card">
      <h1>Before you begin</h1>
      <p class="muted">These questions check whether you meet the study's approved eligibility requirements. They do not ask for your birth date or address.</p>
      <form id="eligibility-form" novalidate>
        <fieldset>
          <legend>Which age group are you in?</legend>
          <div class="choice-list">
            ${cats
              .map(
                (c) => `<label class="choice"><input type="radio" name="ageCategory" value="${esc(c.value)}" /> <span>${esc(c.label)}</span></label>`
              )
              .join("")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Recruitment</legend>
          <label class="choice"><input type="checkbox" name="meetsCriteria" value="yes" /> <span>${esc(config.eligibility.recruitmentCriteriaText)}</span></label>
        </fieldset>
        ${
          rc && rc.enabled
            ? `<div class="field-row">
                <label class="block" for="recruitmentCode">${esc(rc.label)}</label>
                <input type="text" id="recruitmentCode" name="recruitmentCode" autocomplete="off" maxlength="16" />
                <p class="help">${esc(rc.help)}</p>
              </div>`
            : ""
        }
        <p class="error" id="eligibility-error" role="alert" hidden></p>
        <div class="actions"><button type="submit" class="btn">Continue</button></div>
      </form>
    </section>`;
}

function viewIneligible() {
  return `
    <section class="card">
      <h1>Thank you</h1>
      ${paragraphs(config.eligibility.ineligibleMessage)}
    </section>`;
}

function viewConsent() {
  const c = config.consent;
  const block = (title, text) => `<div class="section"><h3>${esc(title)}</h3>${paragraphs(text)}</div>`;
  return `
    <section class="card">
      <h1>${esc(c.heading)}</h1>
      <p class="muted small">Read this information before deciding. It is the same for everyone in the study.</p>
      ${block("What you will do", config.intro.body)}
      ${block("Who is doing this research", `${c.researcherContact}\n\n${c.supervisorContact}`)}
      ${block("Who can take part", c.participationRequirements)}
      ${block("What the research app records", c.dataCollected)}
      ${block("How the information is stored and who can see it", c.storageAndAccess)}
      ${block("Leaving the study", c.withdrawal)}
      ${block("How long it takes", c.duration)}
      ${block("Parental permission", c.parentalPermissionNote)}
      <div class="notice-box">
        <p class="small muted tight">The fictional platform inside the study will ask you to make choices about an age check. Those choices are part of the simulation. Only the research app collects anything, and only what is listed above.</p>
      </div>
      <form id="consent-form" novalidate>
        <label class="choice"><input type="checkbox" name="assent" value="yes" /> <span>${esc(c.assentStatement)}</span></label>
        <p class="error" id="consent-error" role="alert" hidden></p>
        <div class="actions">
          <button type="submit" class="btn">${esc(c.agreeLabel)}</button>
          <button type="button" class="btn btn-secondary" id="consent-decline">${esc(c.declineLabel)}</button>
        </div>
      </form>
    </section>`;
}

function viewNotParticipating() {
  return `
    <section class="card">
      <h1>Thank you</h1>
      ${paragraphs(config.consent.declinedMessage)}
    </section>`;
}

function platformFrame(inner, { title = config.platformName } = {}) {
  return `
    <div class="platform" aria-label="Fictional platform screen">
      <div class="platform-bar"><span>${esc(title)}</span><span class="platform-tag">Fictional platform · simulation</span></div>
      <div class="platform-body">${inner}</div>
    </div>`;
}

function viewScenario() {
  const c = config.scenario;
  return `
    <section class="card">
      <h1>${esc(c.heading)}</h1>
      ${paragraphs(c.body)}
      <div class="actions"><button type="button" class="btn" id="scenario-continue">${esc(c.continueLabel)}</button></div>
    </section>`;
}

function viewVerification() {
  const v = config.verification;
  const advance = session.condition === E.CONDITION.ADVANCE;
  // The advance-notice group reads the sentence. The later-notice group gets
  // the same sentence as an invisible, inert spacer: it takes exactly the room
  // the real one would at any screen width or text size, so the buttons sit in
  // the same place in both conditions, and it is hidden from sight, from
  // screen readers, and from the page's readable text.
  const notice = advance
    ? `<p class="notice-text" id="notice-sentence">${esc(v.advanceNoticeSentence)}</p>`
    : `<p class="notice-text notice-reserve" aria-hidden="true">${esc(v.advanceNoticeSentence)}</p>`;
  return `
    <section class="card">
      ${platformFrame(`
        <h2>${esc(v.heading)}</h2>
        <p>${esc(v.body)}</p>
        <div class="notice-slot" data-condition="${esc(session.condition)}">${notice}</div>
        <div class="actions-equal">
          <button type="button" class="btn btn-choice" id="verify-start">${esc(v.startLabel)}</button>
          <button type="button" class="btn btn-choice" id="verify-decline">${esc(v.declineLabel)}</button>
        </div>
      `)}
      <p class="study-note">Study note: this is a simulation. Choose as you would on a real platform. Declining the platform's verification is not the same as withdrawing from the study.</p>
    </section>`;
}

function faceSvg() {
  return `
    <svg viewBox="0 0 160 160" role="img" aria-label="Abstract face outline placeholder" focusable="false">
      <rect x="8" y="8" width="144" height="144" rx="18" fill="none" stroke="#c7cfda" stroke-width="3" stroke-dasharray="8 6" />
      <ellipse cx="80" cy="78" rx="38" ry="46" fill="none" stroke="#3a4a63" stroke-width="3" />
      <circle cx="66" cy="70" r="3.5" fill="#3a4a63" />
      <circle cx="94" cy="70" r="3.5" fill="#3a4a63" />
      <path d="M68 98 Q80 108 92 98" fill="none" stroke="#3a4a63" stroke-width="3" stroke-linecap="round" />
      <path d="M28 40 V22 H46 M114 22 H132 V40 M28 120 V138 H46 M114 138 H132 V120" fill="none" stroke="#3a4a63" stroke-width="3" stroke-linecap="round" />
    </svg>`;
}

function viewSimulation() {
  const s = config.simulation;
  return `
    <section class="card">
      ${platformFrame(`
        <span class="sim-label">${esc(s.label)}</span>
        <div class="sim-figure">${faceSvg()}</div>
        <div class="progress" role="progressbar" aria-label="${esc(s.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="sim-progress">
          <div class="progress-fill" id="sim-fill"></div>
        </div>
        <p class="sim-status" id="sim-status" aria-live="polite">${esc(s.status)}</p>
      `)}
      <p class="muted small">No camera is used. This screen is a fixed animation.</p>
    </section>`;
}

function viewResult() {
  const r = config.result;
  return `
    <section class="card">
      ${platformFrame(`
        <h2>${esc(r.line1)}</h2>
        <p>${esc(r.line2)}</p>
        <p><strong>${esc(r.line3)}</strong></p>
        <div class="actions-equal">
          <button type="button" class="btn btn-choice" id="id-continue">${esc(r.continueLabel)}</button>
          <button type="button" class="btn btn-choice" id="id-stop">${esc(r.stopLabel)}</button>
        </div>
      `)}
    </section>`;
}

function viewConfirmation() {
  let text;
  if (session.idDecision === E.ID.CONTINUE) text = config.result.continueConfirmation;
  else if (session.idDecision === E.ID.STOP) text = config.result.stopConfirmation;
  else text = config.verification.declinedMessage;
  return `
    <section class="card">
      ${platformFrame(`<h2>${esc(text)}</h2>`)}
      <p class="muted">The simulation is over. The next screen has a short questionnaire from the research app.</p>
      <div class="actions"><button type="button" class="btn" id="to-questionnaire">${esc(config.result.nextLabel)}</button></div>
    </section>`;
}

// Returns a single-choice answer to blank. Always takes up its line (so nothing
// jumps when it appears) and is only reachable once there is an answer to clear.
function clearButton(item) {
  return `<div class="clear-row"><button type="button" class="link-btn clear-answer" data-clear="${esc(item.id)}" aria-label="Clear answer: ${esc(item.text)}" disabled>Clear answer</button></div>`;
}

function likertItem(item, scale) {
  return `
    <fieldset class="likert" data-item="${esc(item.id)}">
      <legend>${esc(item.text)}</legend>
      <div class="likert-options">
        ${scale
          .map(
            (s) => `<label class="choice"><input type="radio" name="${esc(item.id)}" value="${s.value}" /> <span>${s.value} · ${esc(s.label)}</span></label>`
          )
          .join("")}
      </div>
      ${clearButton(item)}
    </fieldset>`;
}

function choiceItem(item, { multiple = false } = {}) {
  const type = multiple ? "checkbox" : "radio";
  return `
    <fieldset data-item="${esc(item.id)}">
      <legend>${esc(item.text)}</legend>
      <div class="choice-list">
        ${item.options
          .map((o) => `<label class="choice"><input type="${type}" name="${esc(item.id)}" value="${esc(o.value)}" /> <span>${esc(o.label)}</span></label>`)
          .join("")}
      </div>
      ${multiple ? "" : clearButton(item)}
    </fieldset>`;
}

function viewQuestionnaire() {
  const q = config.questionnaire;
  const reachedId = session.reachedResult === true;
  const pathway = E.finalPathway(session);
  const declinedOrStopped = pathway === "declined_before_check" || pathway === "stopped_at_id_request";
  const items = q.items.filter((it) => !it.onlyIfReachedIdPrompt || reachedId);
  const sub = session.submission;
  const submitting = sub.status === "submitting";
  const failed = sub.status === "failed";
  return `
    <section class="card">
      <h1>${esc(q.heading)}</h1>
      <p>${esc(q.instruction)}</p>
      <form id="questionnaire-form" novalidate>
        <p class="scale-key">${q.scale.map((s) => `${s.value} = ${esc(s.label)}`).join(" · ")}</p>
        ${items.map((it) => likertItem(it, q.scale)).join("")}
        <div class="section"></div>
        ${choiceItem(q.recall)}
        ${choiceItem(q.priorExperience)}
        ${choiceItem(q.idAvailability)}
        ${choiceItem(q.breachAwareness)}
        <div class="field-row">
          <label class="block" for="open_influence">${esc(q.openEnded.text)}</label>
          <textarea id="open_influence" name="open_influence" maxlength="${q.openEnded.maxLength}"></textarea>
          <p class="help">Optional. Do not include your name or other personal details.</p>
        </div>
        ${declinedOrStopped ? choiceItem(q.stopReasons, { multiple: true }) : ""}
        ${config.demographics.enabled ? config.demographics.items.map((it) => choiceItem(it)).join("") : ""}
        ${
          failed
            ? `<div class="notice-box danger" role="alert">
                <p><strong>Your answers were not submitted.</strong> ${esc(sub.error)}</p>
                <p class="small tight">Your answers are still on this page. You can try again. Nothing is lost by retrying, and retrying will not create a duplicate record.</p>
              </div>`
            : ""
        }
        <div class="actions">
          <button type="submit" class="btn" id="submit-btn" ${submitting ? 'disabled aria-disabled="true"' : ""}>
            ${submitting ? "Submitting…" : failed ? "Try again" : esc(q.submitLabel)}
          </button>
        </div>
        <p class="help">You can leave any question blank. Your answers stay on this page until you submit them.</p>
      </form>
    </section>`;
}

function viewDebrief() {
  const d = config.debrief;
  return `
    <section class="card">
      <h1>${esc(d.heading)}</h1>
      ${paragraphs(d.body)}
      ${paragraphs(d.scope)}
      <div class="section">
        <h3>If you want your answers removed</h3>
        ${paragraphs(config.consent.withdrawal)}
        <p>${esc(d.responseCodeIntro)}</p>
        <div class="code" id="response-code">${esc(session.responseCode)}</div>
      </div>
      <div class="actions"><button type="button" class="btn" id="finish-btn">${esc(d.finishLabel)}</button></div>
    </section>`;
}

function viewFinished() {
  return `
    <section class="card">
      <h1>Thank you</h1>
      ${paragraphs(config.debrief.finishedMessage)}
      <p class="muted small">Your response code: <strong>${esc(session.responseCode)}</strong></p>
      <div class="actions"><button type="button" class="btn btn-secondary" id="new-session">Start a new session on this device</button></div>
    </section>`;
}

function viewWithdrawn() {
  return `
    <section class="card">
      <h1>Withdrawn</h1>
      ${paragraphs(config.withdrawal.withdrawnMessage)}
      <div id="withdrawal-status" role="status" aria-live="polite">${withdrawalStatusHtml()}</div>
      <p class="muted small">Response code for any later request about this session: <strong id="withdrawn-code">${esc(session.responseCode)}</strong></p>
      <div class="actions" id="withdrawn-actions" ${session.withdrawalSync === "saved" ? "" : "hidden"}>
        <button type="button" class="btn btn-secondary" id="new-session">Start a new session on this device</button>
      </div>
    </section>`;
}

function viewCollectionDisabled() {
  return `
    <section class="card">
      <h1>Collection is not configured</h1>
      <p>This app is in research mode, but no storage configuration is active, so it cannot run participants. The researcher must complete the configuration in the dashboard before collection.</p>
    </section>`;
}

// The configuration failed its checks. Visitors to a deployed page get a plain
// message; the reasons go to the console. On the researcher's own browser the
// reasons are listed, since the configuration there is theirs to fix.
function viewUnavailable(problems, source) {
  const detail =
    source === "file"
      ? ""
      : `<div class="notice-box warn"><p class="tight"><strong>For the researcher:</strong> the configuration saved in this browser did not pass its checks. Open the researcher dashboard to fix it.</p><ul>${problems
          .slice(0, 12)
          .map((p) => `<li>${esc(p)}</li>`)
          .join("")}</ul></div>`;
  return `
    <section class="card">
      <h1>This study page is not available right now</h1>
      <p>Nothing has been recorded. Please tell the person who gave you this link.</p>
      ${detail}
    </section>`;
}

// ---------------------------------------------------------------------------
// Render and wire

function render() {
  if (simulationTimer) {
    clearTimeout(simulationTimer);
    simulationTimer = null;
  }
  renderHeader();
  keepHistoryOnPage();
  renderSync();

  if (!isPreview() && !store) {
    root.innerHTML = viewCollectionDisabled();
    return;
  }

  const views = {
    intro: viewIntro,
    eligibility: viewEligibility,
    ineligible: viewIneligible,
    consent: viewConsent,
    not_participating: viewNotParticipating,
    scenario: viewScenario,
    verification: viewVerification,
    simulation: viewSimulation,
    result: viewResult,
    confirmation: viewConfirmation,
    questionnaire: viewQuestionnaire,
    debrief: viewDebrief,
    finished: viewFinished,
    withdrawn: viewWithdrawn,
  };
  const view = views[session.step] || viewIntro;
  root.innerHTML = view();
  root.dataset.step = session.step;
  renderedAt = performance.now();
  wire();
  if (dialog.open) {
    // The step changed underneath an open dialog (for example a submission
    // finished). Withdrawal may no longer apply; if so, close it.
    if (!E.canWithdraw(session)) dialog.close("cancel");
  } else {
    focusHeading();
  }
}

let renderedAt = 0;
const SETTLE_MS = 350;

function on(id, event, handler) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  if (event === "click") {
    // The second half of a double click (detail >= 2) that lands within a
    // few hundred milliseconds of a new screen appearing was meant for the
    // previous screen. Ignore it so no screen is skipped by accident.
    el.addEventListener(event, (ev) => {
      if (ev.detail >= 2 && performance.now() - renderedAt < SETTLE_MS) return;
      handler(ev);
    });
  } else {
    el.addEventListener(event, handler);
  }
}

function wire() {
  on("intro-continue", "click", () => {
    E.begin(session);
    persist();
    render();
  });

  const eligibility = root.querySelector("#eligibility-form");
  if (eligibility && drafts.eligibility) {
    const d = drafts.eligibility;
    if (d.ageCategory) {
      const radio = eligibility.querySelector(`input[name="ageCategory"][value="${CSS.escape(d.ageCategory)}"]`);
      if (radio) radio.checked = true;
    }
    eligibility.querySelector('input[name="meetsCriteria"]').checked = d.meetsCriteria === true;
    const code = eligibility.querySelector('input[name="recruitmentCode"]');
    if (code && d.recruitmentCode) code.value = d.recruitmentCode;
  }
  on("eligibility-form", "submit", (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const age = form.querySelector('input[name="ageCategory"]:checked');
    const err = form.querySelector("#eligibility-error");
    if (!age) {
      err.textContent = "Choose an age group to continue.";
      err.hidden = false;
      form.querySelector('input[name="ageCategory"]').focus();
      return;
    }
    const codeEl = form.querySelector('input[name="recruitmentCode"]');
    E.submitEligibility(session, config, {
      ageCategory: age.value,
      meetsCriteria: form.querySelector('input[name="meetsCriteria"]').checked,
      recruitmentCode: codeEl ? codeEl.value : null,
    });
    dropDraft("eligibility"); // answered; an ineligible visitor's answers are not kept anywhere
    persist();
    render();
  });

  const consent = root.querySelector("#consent-form");
  if (consent && drafts.consent) consent.querySelector('input[name="assent"]').checked = drafts.consent.assent === true;
  on("consent-form", "submit", (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const err = form.querySelector("#consent-error");
    if (!form.querySelector('input[name="assent"]').checked) {
      err.textContent = "Check the box to agree, or choose the other option.";
      err.hidden = false;
      form.querySelector('input[name="assent"]').focus();
      return;
    }
    E.giveAssent(session, config, { forcedCondition: forcedConditionFromUrl() });
    dropDraft("consent");
    persist();
    render();
    saveMilestone();
  });

  on("consent-decline", "click", () => {
    E.declineAssent(session);
    dropDraft("consent");
    persist();
    render();
  });

  on("scenario-continue", "click", () => {
    E.continueScenario(session);
    persist();
    render();
  });

  if (session.step === "verification") {
    // The card for the assigned condition is now in the DOM. Save that
    // milestone right away, so someone who leaves on this screen is still
    // recorded as having seen it.
    if (E.confirmVerificationDisplayed(session)) {
      persist();
      saveMilestone();
    }
    on("verify-start", "click", () => {
      E.initialDecision(session, E.INITIAL.START);
      persist();
      render();
      saveMilestone();
    });
    on("verify-decline", "click", () => {
      E.initialDecision(session, E.INITIAL.DECLINE);
      persist();
      render();
      saveMilestone();
    });
  }

  if (session.step === "simulation") runSimulation();

  on("id-continue", "click", () => {
    E.idDecision(session, E.ID.CONTINUE);
    persist();
    render();
    saveMilestone();
  });
  on("id-stop", "click", () => {
    E.idDecision(session, E.ID.STOP);
    persist();
    render();
    saveMilestone();
  });

  on("to-questionnaire", "click", () => {
    E.beginQuestionnaire(session);
    persist();
    render();
  });

  const questionnaire = root.querySelector("#questionnaire-form");
  if (questionnaire) {
    // Drafts first; after a failed submission they are the same answers anyway.
    applyAnswers(questionnaire, drafts.questionnaire || session.questionnaire);
    updateClearButtons(questionnaire);
    for (const btn of questionnaire.querySelectorAll("[data-clear]")) {
      btn.addEventListener("click", () => {
        const name = btn.dataset.clear;
        const radios = questionnaire.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
        for (const r of radios) r.checked = false;
        captureDraft(questionnaire);
        if (radios.length) radios[0].focus();
      });
    }
    questionnaire.addEventListener("submit", (ev) => {
      ev.preventDefault();
      submitAnswers(readAnswers(questionnaire));
    });
  }

  on("finish-btn", "click", () => {
    E.finish(session);
    persist();
    render();
  });

  on("new-session", "click", () => {
    startFreshSession();
    persist();
    render();
  });

  on("withdrawal-retry", "click", () => saveWithdrawal());
}

function runSimulation() {
  // A refresh during the simulation restarts the fixed animation.
  E.restartSimulation(session);
  persist();
  const fill = root.querySelector("#sim-fill");
  const bar = root.querySelector("#sim-progress");
  const duration = config.simulation.durationMs;
  const started = performance.now();
  requestAnimationFrame(() => {
    if (fill) fill.classList.add("running");
  });
  const tick = () => {
    const pct = Math.min(100, Math.round(((performance.now() - started) / duration) * 100));
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
    if (pct < 100 && session.step === "simulation") requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  simulationTimer = setTimeout(() => {
    simulationTimer = null;
    if (session.step !== "simulation") return;
    E.simulationComplete(session);
    persist();
    render();
    // Reaching the uncertain result and ID prompt is a milestone of its own.
    saveMilestone();
  }, duration);
}

async function submitAnswers(answers) {
  const before = session.submission.status;
  if (before === "submitting" || before === "submitted") return;
  if (before === "failed") E.retrySubmit(session, answers);
  else E.submitQuestionnaire(session, answers);
  drafts.questionnaire = answers;
  storeDrafts();
  if (sync.state === "failed") sync = { state: "idle", error: null }; // this save reports its own result below
  persist();
  render();
  let done = false;
  try {
    if (isPreview() && params.get("failSubmit") === "1" && session.submission.attempts === 1) {
      throw new Error("Simulated submission failure (preview test hook).");
    }
    await enqueueSave();
    done = E.markSubmitted(session);
  } catch (err) {
    E.markSubmitFailed(session, messageOf(err));
  }
  // If the participant withdrew while the save was in flight, the session has
  // already moved on and the withdrawal's own save follows this one.
  if (session.step === "withdrawn") return;
  if (done) dropDraft("questionnaire"); // submitted: no longer a draft
  persist();
  render();
}

// ---------------------------------------------------------------------------
// Boot

async function init() {
  const resolved = await resolveConfig();
  config = resolved.config;
  configSource = resolved.source;
  document.title = config.appName;

  root.dataset.mode = config.mode;
  root.dataset.configSource = configSource;
  root.dataset.studyVersion = config.studyVersion;

  if (resolved.problems.length) {
    // A configuration that fails its checks never runs participants.
    root.dataset.blocked = "true";
    if (window.console && console.warn) console.warn(`AgeCheck Study configuration problems (${configSource}):\n- ${resolved.problems.join("\n- ")}`);
    headerRight.innerHTML = "";
    root.innerHTML = viewUnavailable(resolved.problems, configSource);
    return;
  }

  store = participantStore(config);

  if (params.get("reset") === "1") {
    clearSession();
    clearDrafts();
    params.delete("reset");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
  }

  // A saved session only continues under the mode and study version it began
  // with. Anything else (for example a preview run left in this tab before
  // research mode was activated) is dropped, drafts included.
  const saved = loadSessionJson();
  session = E.restoreSession(saved, config);
  if (!session) {
    if (saved) clearDrafts();
    session = E.createSession(config);
    if (saved) persist();
  }
  drafts = loadDrafts();

  setupDialog();

  // Every change to a form is kept as a draft straight away.
  const onFormChange = (ev) => captureDraft(ev.target && ev.target.closest ? ev.target.closest("form") : null);
  root.addEventListener("input", onFormChange);
  root.addEventListener("change", onFormChange);

  window.addEventListener("popstate", () => {
    if (E.hasRecord(session)) history.pushState({ agecheck: true }, "");
    render();
  });

  render();

  // After a reload, bring the storage up to date with what this tab knows.
  if (E.hasRecord(session)) {
    if (session.step === "withdrawn") {
      if (session.withdrawalSync !== "saved") saveWithdrawal();
    } else if (session.submission.status !== "submitted") {
      saveMilestone();
    }
  }
}

init().catch((err) => {
  root.innerHTML = `<section class="card"><h1>Something went wrong</h1><p>${esc(err && err.message ? err.message : String(err))}</p></section>`;
});
