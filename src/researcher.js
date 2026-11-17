// AgeCheck Study: researcher dashboard.
//
// Shows counts by condition and pathway, the records behind them, exports,
// the data dictionary, deletion by response code, demo-data tools, and the
// study configuration editor with the activation checks for research mode.
//
// Demo data and research data are separate stores with separate exports and
// are never shown together. This page carries no secret: in remote mode the
// server checks the admin token on every request.

import { FIELDS, PATHWAYS, PATHWAY_LABELS, CONDITIONS, CONDITION_LABELS } from "./data-dictionary.js";
import {
  activationProblems,
  validateConfig,
  parseConfig,
  mergeConfig,
  cloneConfig,
  DEFAULT_STUDY_CONFIG,
  findPlaceholders,
} from "./study-config.js";
import {
  resolveConfig,
  loadLocalConfig,
  saveLocalConfig,
  clearLocalConfig,
  loadConfigDraft,
  saveConfigDraft,
  clearConfigDraft,
  demoStore,
  localResearchStore,
  RemoteRecordStore,
  getAdminToken,
  setAdminToken,
} from "./storage.js";
import { generateDemoRecords } from "./demo-data.js";
import { toCSV, toJSON, dictionaryToCSV, downloadText } from "./export.js";
import { EMPTY_FILTERS, filterRecords, hasActiveFilters, studyVersions, summarize, formatRate } from "./summary.js";

const root = document.getElementById("app");

const STATUS_LABELS = { in_progress: "In progress", submitted: "Submitted", withdrawn: "Withdrawn" };

const state = {
  config: null, // the configuration saved in this browser
  draft: null, // unsaved edits to it, or null
  activeConfig: null, // what the participant app would actually use
  activeSource: "default",
  activeProblems: [],
  tab: "overview",
  source: "demo", // "demo" | "research"
  records: [],
  filters: { ...EMPTY_FILTERS },
  loadedAt: "",
  loadError: null,
  message: null,
  problems: null, // result of the last check: { title, list }
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function editing() {
  return state.draft || state.config;
}

function isFrozen() {
  return state.config.mode === "research";
}

function researchAvailable() {
  const c = state.activeConfig;
  return c.mode === "research" && c.storage && c.storage.adapter !== "none" && state.activeProblems.length === 0;
}

function sourceLabel() {
  return state.source === "demo" ? "demo" : "research";
}

function currentStore() {
  if (state.source === "demo") return demoStore();
  const c = state.activeConfig;
  if (c.storage.adapter === "remote-endpoint") {
    return new RemoteRecordStore({ endpointUrl: c.storage.endpointUrl, submitToken: "" });
  }
  return localResearchStore();
}

async function loadRecords() {
  state.loadError = null;
  try {
    const store = currentStore();
    if (store.kind === "remote") {
      const token = getAdminToken();
      if (!token) {
        state.records = [];
        state.loadError = "Enter the admin token to load records from the server.";
        return;
      }
      state.records = await store.list(token);
    } else {
      state.records = await store.list();
    }
    state.loadedAt = new Date().toLocaleTimeString();
  } catch (err) {
    state.records = [];
    state.loadError = err.message;
  }
  // A filter for a version that is no longer present would hide everything.
  if (state.filters.version && !studyVersions(state.records).includes(state.filters.version)) state.filters.version = "";
}

function visibleRecords() {
  return filterRecords(state.records, state.filters);
}

function filterSummary() {
  const f = state.filters;
  const parts = [];
  if (f.condition) parts.push(`condition: ${CONDITION_LABELS[f.condition]}`);
  if (f.pathway) parts.push(`pathway: ${PATHWAY_LABELS[f.pathway]}`);
  if (f.status) parts.push(`status: ${STATUS_LABELS[f.status]}`);
  if (f.version) parts.push(`study version: ${f.version}`);
  return parts.length ? parts.join("; ") : "no filters";
}

// ---------------------------------------------------------------------------
// Tabs

const TABS = [
  ["overview", "Overview"],
  ["records", "Records"],
  ["export", "Export"],
  ["dictionary", "Data dictionary"],
  ["delete", "Delete by code"],
  ["demo", "Demo data"],
  ["config", "Configuration"],
];

function modeBanner() {
  const c = state.activeConfig;
  const srcText = {
    file: "study.config.json served next to the page (deployed configuration). Edits saved in this browser do not change it.",
    local: "the configuration saved in this browser. It applies to the participant app in this browser only.",
    default: "the built-in defaults. Nothing has been configured yet.",
  }[state.activeSource];
  const storageText =
    c.mode !== "research"
      ? "Preview mode. Participant runs are saved as clearly marked walkthrough records in the demo store. No research data is collected."
      : c.storage.adapter === "local-device"
        ? "Research mode with local-device storage. Records are kept in the participant browser's local storage on that device only. A participant on another device is NOT collected anywhere. Use this only for in-person sessions on a device you control, and export after each session."
        : c.storage.adapter === "remote-endpoint"
          ? `Research mode with a remote endpoint (${esc(c.storage.endpointUrl)}). Records are sent to that server, so collection works across devices while it is reachable. Check what the host logs (IP addresses, timestamps) before promising anonymity.`
          : "Research mode without storage. Collection is disabled.";
  const blocked = state.activeProblems.length
    ? `<div class="notice-box danger" role="alert"><p class="tight"><strong>The active configuration does not pass its checks, so the participant app will not run.</strong></p><ul>${state.activeProblems
        .slice(0, 12)
        .map((p) => `<li>${esc(p)}</li>`)
        .join("")}</ul></div>`
    : "";
  return `
    <div class="notice-box ${c.mode === "research" ? "" : "warn"}">
      <p class="tight"><strong>${c.mode === "research" ? "Research mode" : "Preview mode"}</strong> · study version ${esc(c.studyVersion)} · active configuration comes from ${srcText}</p>
      <p class="tight small muted">${storageText}</p>
    </div>
    ${blocked}`;
}

function option(value, label, selected) {
  return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
}

function dataToolbar() {
  const ra = researchAvailable();
  const f = state.filters;
  const shown = visibleRecords().length;
  const total = state.records.length;
  const versions = studyVersions(state.records);
  return `
    <div class="toolbar" role="group" aria-label="Data source">
      <span><strong>Viewing:</strong></span>
      <button type="button" class="btn ${state.source === "demo" ? "" : "btn-secondary"}" data-source="demo" aria-pressed="${state.source === "demo"}">Demo data (synthetic and walkthroughs)</button>
      <button type="button" class="btn ${state.source === "research" ? "" : "btn-secondary"}" data-source="research" aria-pressed="${state.source === "research"}" ${ra ? "" : "disabled"}>Research data${ra ? "" : " (research mode not active)"}</button>
      <button type="button" class="btn btn-secondary" id="refresh-btn">Refresh records</button>
    </div>
    ${
      state.source === "research" && state.activeConfig.storage.adapter === "remote-endpoint"
        ? `<div class="toolbar card-gap">
            <label class="block" for="admin-token">Admin token (kept for this tab only)</label>
            <input type="password" id="admin-token" autocomplete="off" value="${esc(getAdminToken())}" />
            <button type="button" class="btn btn-secondary" id="admin-token-save">Use token</button>
          </div>`
        : ""
    }
    ${state.loadError ? `<p class="error" role="alert">${esc(state.loadError)}</p>` : ""}
    <div class="filters" role="group" aria-label="Filters">
      <div>
        <label for="filter-condition">Condition</label>
        <select id="filter-condition" data-filter="condition">
          ${option("", "Any condition", !f.condition)}
          ${CONDITIONS.map((c) => option(c, CONDITION_LABELS[c], f.condition === c)).join("")}
        </select>
      </div>
      <div>
        <label for="filter-pathway">Pathway</label>
        <select id="filter-pathway" data-filter="pathway">
          ${option("", "Any pathway", !f.pathway)}
          ${PATHWAYS.map((p) => option(p, PATHWAY_LABELS[p], f.pathway === p)).join("")}
        </select>
      </div>
      <div>
        <label for="filter-status">Submission status</label>
        <select id="filter-status" data-filter="status">
          ${option("", "Any status", !f.status)}
          ${Object.keys(STATUS_LABELS)
            .map((s) => option(s, STATUS_LABELS[s], f.status === s))
            .join("")}
        </select>
      </div>
      <div>
        <label for="filter-version">Study version</label>
        <select id="filter-version" data-filter="version">
          ${option("", "Any version", !f.version)}
          ${versions.map((v) => option(v, v, f.version === v)).join("")}
        </select>
      </div>
    </div>
    <p class="scope-line" id="scope-line">Showing ${shown} of ${total} ${sourceLabel()} record${total === 1 ? "" : "s"} (${esc(filterSummary())}).</p>
    <p class="small muted tight">${state.loadedAt ? `Loaded at ${esc(state.loadedAt)}. ` : ""}Records saved since then appear after Refresh. Demo and research records are never combined.
      ${hasActiveFilters(f) ? '<button type="button" class="link-btn" id="filters-clear">Clear filters</button>' : ""}</p>`;
}

// ---------------------------------------------------------------------------
// Overview

function viewOverview() {
  const rs = visibleRecords();
  const s = summarize(rs).byCondition;
  const rows = [
    ["Assigned (all records shown)", "assigned"],
    ["Withdrawn from study", "withdrawn"],
    ["Not withdrawn", "eligible"],
    ["Declined before the simulated check", "declined"],
    ["Started the simulated check", "started"],
    ["Reached the ID prompt", "reachedId"],
    ["Stopped at the ID request", "stopped"],
    ["Would continue with ID verification", "continued"],
    ["Incomplete session", "incomplete"],
    ["Questionnaire missing (among those not withdrawn)", "questionnaireMissing"],
  ];
  const head = CONDITIONS.map((c) => `<th>${esc(CONDITION_LABELS[c])}</th>`).join("");
  const pathwayTable = `
    <div class="table-wrap"><table id="pathway-table">
      <thead><tr><th>Final pathway</th>${head}<th>Total</th></tr></thead>
      <tbody>
        ${PATHWAYS.map((p) => {
          const counts = CONDITIONS.map((c) => rs.filter((r) => r.condition === c && r.final_pathway === p).length);
          return `<tr><td>${esc(PATHWAY_LABELS[p])}</td>${counts.map((n) => `<td>${n}</td>`).join("")}<td>${counts.reduce((a, b) => a + b, 0)}</td></tr>`;
        }).join("")}
        <tr><th>Total</th>${CONDITIONS.map((c) => `<th>${s[c].assigned}</th>`).join("")}<th>${rs.length}</th></tr>
      </tbody>
    </table></div>`;
  const stageTable = `
    <div class="table-wrap"><table id="stage-table">
      <thead><tr><th>Count</th>${head}</tr></thead>
      <tbody>${rows.map(([label, key]) => `<tr><td>${esc(label)}</td>${CONDITIONS.map((c) => `<td>${s[c][key]}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  const rateRow = (id, label, key) =>
    `<tr data-rate="${id}"><td>${label}</td>${CONDITIONS.map((c) => `<td>${esc(formatRate(s[c].rates[key]))}</td>`).join("")}</tr>`;
  const outcome = `
    <div class="table-wrap"><table id="outcome-table">
      <thead><tr><th>Primary completion outcome: would continue with ID</th>${head}</tr></thead>
      <tbody>
        ${rateRow("assigned", "Among all assigned. A withdrawn participant counts in the denominator and never as continuing.", "continuedAmongAssigned")}
        ${rateRow("excluding-withdrawn", "Excluding withdrawn. Numerator and denominator both come from participants who did not withdraw.", "continuedExcludingWithdrawn")}
        ${rateRow("started", "Initial stage only: started the check, among participants who did not withdraw.", "startedExcludingWithdrawn")}
        ${rateRow("reached", "ID stage only: would continue, among those who reached the prompt and did not withdraw. Descriptive: this subgroup is shaped by earlier choices and is not a fair between-condition comparison.", "continuedAmongReached")}
      </tbody>
    </table></div>`;
  return `
    <section class="card card-gap">
      <h2>Counts by condition and pathway</h2>
      ${state.source === "demo" ? '<p class="small muted">These are demo records (synthetic data and preview walkthroughs). They say nothing about real participants.</p>' : ""}
      ${rs.length === 0 ? '<p class="notice-box" id="empty-note">No records match. Every count below is zero and every rate reads "no records".</p>' : ""}
      ${pathwayTable}
      <h3 class="section">Stage counts</h3>
      <p class="small muted">Decision counts (declined, started, reached, stopped, would continue, incomplete) and the missing-questionnaire count cover participants who did not withdraw, whatever the withdrawal policy kept on a withdrawn record.</p>
      ${stageTable}
      <h3 class="section">Completion outcome</h3>
      ${outcome}
      <p class="small muted">Counts and proportions only. A group with no records reads "no records", not 0%. The dashboard performs no significance tests and computes no combined scores. Risk, transparency, unexpectedness, and recall items are stored individually in the export. Which denominator to use for withdrawn participants follows the approved withdrawal policy.</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// Records

function viewRecords() {
  const rs = visibleRecords();
  const cols = ["response_code", "record_kind", "study_version", "condition", "initial_decision", "id_decision", "final_pathway", "submission_status", "questionnaire_status", "q_recall_notice"];
  return `
    <section class="card card-gap">
      <h2>Records</h2>
      <div class="table-wrap"><table id="records-table">
        <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rs.length === 0 ? `<tr><td colspan="${cols.length}">No records match.</td></tr>` : ""}
          ${rs.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table></div>
      <p class="small muted">Full fields are in the export. Free-text answers are not shown here; review them in the export before sharing.</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// Export

function exportFileName(records, scope, ext) {
  const versions = studyVersions(records);
  const stamp = versions.length === 1 ? `v${versions[0].replace(/[^A-Za-z0-9.-]/g, "_")}` : versions.length ? "mixed-versions" : "empty";
  return `agecheck-${sourceLabel()}-${scope}-${stamp}.${ext}`;
}

function viewExport() {
  const label = sourceLabel();
  const shown = visibleRecords();
  const total = state.records.length;
  const filtered = hasActiveFilters(state.filters);
  const versions = studyVersions(shown);
  return `
    <section class="card card-gap">
      <h2>Export ${label} data</h2>
      <p>Exports contain only the approved fields in the data dictionary, in dictionary order.</p>
      <div class="notice-box" id="export-scope">
        <p class="tight"><strong>What this export contains</strong></p>
        <ul>
          <li>Data source: <strong>${label} data only</strong>. ${label === "demo" ? "Research records are never included." : "Demo records are never included."}</li>
          <li>Records: <strong>${shown.length} of ${total}</strong> ${filtered ? `(filtered: ${esc(filterSummary())})` : "(all records in this data source)"}.</li>
          <li>Study version${versions.length === 1 ? "" : "s"}: ${versions.length ? esc(versions.join(", ")) : "none"}.</li>
          <li>Records as loaded${state.loadedAt ? ` at ${esc(state.loadedAt)}` : ""}. Use Refresh records first if participants may have finished since.</li>
        </ul>
      </div>
      <div class="actions">
        <button type="button" class="btn" id="export-csv">Download CSV: ${filtered ? "the" : "all"} ${shown.length} record${shown.length === 1 ? "" : "s"}${filtered ? " shown" : ""}</button>
        <button type="button" class="btn btn-secondary" id="export-json">Download JSON: ${filtered ? "the" : "all"} ${shown.length} record${shown.length === 1 ? "" : "s"}${filtered ? " shown" : ""}</button>
      </div>
      ${
        filtered
          ? `<div class="actions">
              <button type="button" class="btn btn-secondary" id="export-csv-all">Download CSV: all ${total} ${label} records, ignoring filters</button>
              <button type="button" class="btn btn-secondary" id="export-json-all">Download JSON: all ${total} ${label} records, ignoring filters</button>
            </div>`
          : ""
      }
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="export-dict">Download data dictionary (CSV)</button>
      </div>
      <p class="small muted">The file name states the data source and whether the export is filtered. Store exports where the approved data-storage plan says. Do not commit them to a repository.</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// Dictionary

function viewDictionary() {
  return `
    <section class="card">
      <h2>Data dictionary</h2>
      <p>Special codes: <code>not_reached</code> (the step or item was never shown), <code>skipped</code> (shown and left blank), <code>missing</code> (questionnaire never submitted), <code>not_applicable</code> (does not apply to the pathway), <code>disabled</code> (turned off in configuration), <code>not_collected</code> (field turned off), <code>withheld</code> (removed under the withdrawal policy).</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Field</th><th>Type</th><th>Values</th><th>Special codes</th><th>Measure</th><th>Meaning</th></tr></thead>
        <tbody>
          ${FIELDS.map(
            (f) => `<tr><td><code>${esc(f.name)}</code></td><td>${esc(f.type)}</td><td>${esc((f.values || []).join(", "))}</td><td>${esc((f.special || []).join(", "))}</td><td>${esc(f.measure || "")}</td><td>${esc(f.description)}</td></tr>`
          ).join("")}
        </tbody>
      </table></div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Delete

function viewDelete() {
  return `
    <section class="card card-gap">
      <h2>Delete a record by response code</h2>
      <p>Participants receive a response code at the debrief and can ask for deletion with it alone. Deletion applies to the whole ${sourceLabel()} data source, whatever the filters show.</p>
      <form id="delete-form" class="inline" novalidate>
        <label class="block" for="delete-code">Response code</label>
        <input type="text" id="delete-code" autocomplete="off" placeholder="ABCD-EFGH" maxlength="9" />
        <button type="submit" class="btn">Delete</button>
      </form>
      ${state.message ? `<p class="notice-box" role="status">${esc(state.message)}</p>` : ""}
    </section>`;
}

// ---------------------------------------------------------------------------
// Demo data

function viewDemo() {
  return `
    <section class="card card-gap">
      <h2>Demo data</h2>
      <p>Generate synthetic records that cover both conditions and every exit pathway. They are marked <code>synthetic_demo</code>, kept in the demo store, and never mixed with research data. Runs of the participant app in preview mode also land here, marked <code>preview_walkthrough</code>.</p>
      <form id="demo-form" class="inline" novalidate>
        <label class="block" for="demo-count">How many</label>
        <input type="text" id="demo-count" inputmode="numeric" value="40" />
        <button type="submit" class="btn">Generate (replace demo set)</button>
        <button type="button" class="btn btn-secondary" id="demo-clear">Clear all demo records</button>
      </form>
      ${state.message ? `<p class="notice-box" role="status">${esc(state.message)}</p>` : ""}
    </section>`;
}

// ---------------------------------------------------------------------------
// Configuration

function textField(id, label, value, { rows = 3, help = "", disabled = false } = {}) {
  return `
    <div class="field-row">
      <label class="block" for="${id}">${esc(label)}</label>
      <textarea id="${id}" rows="${rows}" ${disabled ? "disabled" : ""}>${esc(value)}</textarea>
      ${help ? `<p class="help">${esc(help)}</p>` : ""}
    </div>`;
}

function inputField(id, label, value, { type = "text", help = "", disabled = false } = {}) {
  return `
    <div class="field-row">
      <label class="block" for="${id}">${esc(label)}</label>
      <input type="${type}" id="${id}" value="${esc(value ?? "")}" ${disabled ? "disabled" : ""} autocomplete="off" />
      ${help ? `<p class="help">${esc(help)}</p>` : ""}
    </div>`;
}

function problemsBox() {
  const p = state.problems;
  if (!p) return "";
  if (!p.list.length) return `<div class="notice-box" role="status" id="config-problems"><p class="tight">${esc(p.ok || "All activation requirements are met.")}</p></div>`;
  return `<div class="notice-box danger" role="alert" id="config-problems"><p class="tight"><strong>${esc(p.title)}</strong></p><ul>${p.list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="small tight">Nothing you typed was changed.</p></div>`;
}

function viewConfig() {
  const c = editing();
  const frozen = isFrozen();
  const d = frozen;
  const placeholders = findPlaceholders(c);
  const retain = c.withdrawal.retainPartialResponses;
  return `
    <section class="card">
      <h2>Study configuration ${state.draft ? '<span class="unsaved" id="unsaved-badge">Unsaved changes</span>' : ""}</h2>
      ${
        frozen
          ? `<div class="notice-box"><p class="tight"><strong>Frozen.</strong> Research mode was activated${c.activatedOn ? ` on ${esc(c.activatedOn)}` : ""} for study version ${esc(c.studyVersion)}. Condition wording, the scenario, and the questionnaire cannot change while collection runs. To change anything, return to preview mode, export existing data first, and activate a new version.</p></div>`
          : `<div class="notice-box warn"><p class="tight">Preview mode. Edit, save to this browser, then check the activation requirements. ${placeholders.length} field(s) still contain placeholder wording. Edits stay in this form until you save them, including while you check requirements or switch tabs.</p></div>`
      }
      <form id="config-form" novalidate>
        <h3>Version</h3>
        ${inputField("cfg-version", "Study version", c.studyVersion, { disabled: d, help: 'Set a non-draft value before activation, for example "1.0.0". Change it for any later revision.' })}

        <h3 class="section">Eligibility and recruitment</h3>
        <div class="grid grid-2">
          ${inputField("cfg-minAge", "Minimum approved age", c.eligibility.minAge, { type: "number", disabled: d })}
          ${inputField("cfg-maxAge", "Maximum approved age", c.eligibility.maxAge, { type: "number", disabled: d })}
        </div>
        ${textField("cfg-criteria", "Recruitment criteria statement (participant checks this box)", c.eligibility.recruitmentCriteriaText, { rows: 2, disabled: d })}
        <label class="choice"><input type="checkbox" id="cfg-rc-enabled" ${c.eligibility.recruitmentCode.enabled ? "checked" : ""} ${d ? "disabled" : ""} /> <span>Ask for an optional recruitment code (only if approved; codes must not contain names or student IDs)</span></label>

        <h3 class="section">Study information and assent wording</h3>
        <p class="small muted">Identical for both conditions. Every field here is required: replace each [PLACEHOLDER] and leave none empty. The app does not supply contacts, approvals, or a retention policy for you.</p>
        ${textField("cfg-researcher", "Researcher contact", c.consent.researcherContact, { rows: 2, disabled: d })}
        ${textField("cfg-supervisor", "Supervisor or teacher contact", c.consent.supervisorContact, { rows: 2, disabled: d })}
        ${textField("cfg-requirements", "Approved participation requirements", c.consent.participationRequirements, { rows: 3, disabled: d })}
        ${textField("cfg-data", "What the research app actually records", c.consent.dataCollected, { rows: 5, disabled: d, help: "Must match the data dictionary. State what the hosting service logs." })}
        ${textField("cfg-storage-text", "Data storage, access, and retention", c.consent.storageAndAccess, { rows: 4, disabled: d })}
        ${textField("cfg-withdrawal-text", "Withdrawal procedure", c.consent.withdrawal, { rows: 3, disabled: d, help: "Also shown at the debrief with the response code." })}
        ${textField("cfg-duration", "Expected duration", c.consent.duration, { rows: 1, disabled: d })}
        ${textField("cfg-parental", "Parental permission note", c.consent.parentalPermissionNote, { rows: 3, disabled: d })}
        ${textField("cfg-assent", "Assent statement (participant checks this box)", c.consent.assentStatement, { rows: 2, disabled: d })}

        <h3 class="section">Withdrawal policy</h3>
        <div class="field-row">
          <label class="block" for="cfg-retain">If a participant withdraws mid-session</label>
          <select id="cfg-retain" ${d ? "disabled" : ""}>
            <option value="" ${retain === null || retain === undefined ? "selected" : ""}>Not chosen yet (required before activation; preview withholds responses)</option>
            <option value="false" ${retain === false ? "selected" : ""}>Keep only the fact of withdrawal, the condition, and the step reached (responses withheld)</option>
            <option value="true" ${retain === true ? "selected" : ""}>Keep partial responses, marked withdrawn</option>
          </select>
          <p class="help">This is the approved retention policy for withdrawals. The app, the stores, and the server all apply it.</p>
        </div>

        <h3 class="section">Optional demographics</h3>
        <label class="choice"><input type="checkbox" id="cfg-demo-enabled" ${c.demographics.enabled ? "checked" : ""} ${d ? "disabled" : ""} /> <span>Ask optional gender and race/ethnicity questions (only if approved and justified by the research plan)</span></label>

        <h3 class="section">Storage</h3>
        <div class="field-row">
          <label class="block" for="cfg-adapter">Where research records go</label>
          <select id="cfg-adapter" ${d ? "disabled" : ""}>
            <option value="none" ${c.storage.adapter === "none" ? "selected" : ""}>Not configured (collection disabled)</option>
            <option value="local-device" ${c.storage.adapter === "local-device" ? "selected" : ""}>This device only (browser local storage; in-person sessions on a researcher-controlled device)</option>
            <option value="remote-endpoint" ${c.storage.adapter === "remote-endpoint" ? "selected" : ""}>Remote endpoint (the reference server in server/, works across devices)</option>
          </select>
        </div>
        ${inputField("cfg-endpoint", "Endpoint URL (remote only)", c.storage.endpointUrl, { disabled: d, help: "For example https://your-host.example. The app posts to <URL>/api/submit." })}
        ${inputField("cfg-token", "Submit token (remote only)", c.storage.submitToken, { type: "password", disabled: d, help: "Must match AGECHECK_SUBMIT_TOKEN on the server. It only allows submitting; it cannot read records." })}

        <div class="actions">
          <button type="submit" class="btn" ${d ? "disabled" : ""}>Save to this browser</button>
          <button type="button" class="btn btn-secondary" id="cfg-check">Check activation requirements</button>
          ${frozen ? `<button type="button" class="btn btn-secondary" id="cfg-deactivate">Return to preview mode</button>` : `<button type="button" class="btn" id="cfg-activate">Activate research mode</button>`}
          ${state.draft && !frozen ? '<button type="button" class="btn btn-secondary" id="cfg-discard">Discard unsaved changes</button>' : ""}
        </div>
        ${problemsBox()}
        ${state.message ? `<p class="notice-box" role="status" id="config-message">${esc(state.message)}</p>` : ""}
      </form>

      <h3 class="section">Deploying the configuration</h3>
      <p class="small">The participant app uses, in order: a <code>study.config.json</code> file served next to it, then the configuration saved in its own browser, then the defaults. Whichever it finds is checked before use; a configuration that fails its checks stops the app instead of falling back. To deploy a frozen configuration, download it and place it next to <code>index.html</code>, or push it to the reference server, which serves it at that path.</p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="cfg-download">Download study.config.json</button>
        <button type="button" class="btn btn-secondary" id="cfg-push" ${c.storage.adapter === "remote-endpoint" ? "" : "disabled"}>Push to server (admin token)</button>
        <button type="button" class="btn btn-secondary" id="cfg-reset" ${d ? "disabled" : ""}>Reset to defaults</button>
      </div>
      <div class="field-row section">
        <label class="block" for="cfg-import">Import a study.config.json by pasting its contents</label>
        <textarea id="cfg-import" rows="4" ${d ? "disabled" : ""}></textarea>
        <div class="actions"><button type="button" class="btn btn-secondary" id="cfg-import-btn" ${d ? "disabled" : ""}>Import</button></div>
      </div>
    </section>`;
}

/** The configuration form as typed, on top of the configuration being edited. */
function readConfigForm() {
  const c = cloneConfig(editing());
  const v = (id) => root.querySelector(`#${id}`).value;
  const int = (id) => {
    const n = Number(v(id));
    return v(id).trim() !== "" && Number.isInteger(n) ? n : null;
  };
  const retain = v("cfg-retain");
  c.studyVersion = v("cfg-version").trim();
  c.eligibility.minAge = int("cfg-minAge");
  c.eligibility.maxAge = int("cfg-maxAge");
  c.eligibility.recruitmentCriteriaText = v("cfg-criteria").trim();
  c.eligibility.recruitmentCode.enabled = root.querySelector("#cfg-rc-enabled").checked;
  c.consent.researcherContact = v("cfg-researcher").trim();
  c.consent.supervisorContact = v("cfg-supervisor").trim();
  c.consent.participationRequirements = v("cfg-requirements").trim();
  c.consent.dataCollected = v("cfg-data").trim();
  c.consent.storageAndAccess = v("cfg-storage-text").trim();
  c.consent.withdrawal = v("cfg-withdrawal-text").trim();
  c.consent.duration = v("cfg-duration").trim();
  c.consent.parentalPermissionNote = v("cfg-parental").trim();
  c.consent.assentStatement = v("cfg-assent").trim();
  c.withdrawal.retainPartialResponses = retain === "true" ? true : retain === "false" ? false : null;
  c.demographics.enabled = root.querySelector("#cfg-demo-enabled").checked;
  c.storage.adapter = v("cfg-adapter");
  c.storage.endpointUrl = v("cfg-endpoint").trim();
  c.storage.submitToken = v("cfg-token").trim();
  return c;
}

/**
 * Keep whatever is in the configuration form as a draft. Called before every
 * re-render, so checking requirements, a failed save, or a tab switch never
 * discards edits. The draft also survives a refresh (this tab only).
 */
function captureConfigDraft() {
  if (!root.querySelector("#config-form") || isFrozen()) return;
  const typed = readConfigForm();
  if (JSON.stringify(typed) === JSON.stringify(state.config)) {
    state.draft = null;
    clearConfigDraft();
  } else {
    state.draft = typed;
    saveConfigDraft(typed);
  }
}

function setSaved(config) {
  state.config = config;
  state.draft = null;
  clearConfigDraft();
  saveLocalConfig(config);
  refreshActive();
}

// ---------------------------------------------------------------------------
// Render

function render() {
  captureConfigDraft();
  const views = {
    overview: viewOverview,
    records: viewRecords,
    export: viewExport,
    dictionary: viewDictionary,
    delete: viewDelete,
    demo: viewDemo,
    config: viewConfig,
  };
  const withData = state.tab !== "config" && state.tab !== "dictionary";
  root.innerHTML = `
    ${modeBanner()}
    <ul class="tabs" role="tablist">
      ${TABS.map(([id, label]) => `<li role="presentation"><button type="button" role="tab" aria-selected="${state.tab === id}" data-tab="${id}">${esc(label)}</button></li>`).join("")}
    </ul>
    ${withData ? `<div class="card" id="data-toolbar">${dataToolbar()}</div>` : ""}
    ${views[state.tab]()}`;
  wire();
}

function exportRecords(records, scope, ext) {
  const name = exportFileName(records, scope, ext);
  if (ext === "csv") {
    downloadText(name, toCSV(records), "text/csv");
    return;
  }
  downloadText(
    name,
    toJSON(records, {
      data_kind: sourceLabel(),
      scope,
      filters: scope === "filtered" ? { ...state.filters } : {},
      total_in_source: state.records.length,
      study_versions: studyVersions(records),
      mode: state.activeConfig.mode,
    }),
    "application/json"
  );
}

function wire() {
  for (const b of root.querySelectorAll("[data-tab]")) {
    b.addEventListener("click", () => {
      captureConfigDraft();
      state.tab = b.dataset.tab;
      state.message = null;
      state.problems = null;
      render();
    });
  }
  for (const b of root.querySelectorAll("[data-source]")) {
    b.addEventListener("click", async () => {
      state.source = b.dataset.source;
      state.message = null;
      state.filters = { ...EMPTY_FILTERS };
      await loadRecords();
      render();
    });
  }
  const refresh = root.querySelector("#refresh-btn");
  if (refresh) {
    refresh.addEventListener("click", async () => {
      await loadRecords();
      render();
      const again = root.querySelector("#refresh-btn");
      if (again) again.focus();
    });
  }
  for (const sel of root.querySelectorAll("[data-filter]")) {
    sel.addEventListener("change", () => {
      state.filters[sel.dataset.filter] = sel.value;
      const id = sel.id;
      render();
      const again = root.querySelector(`#${id}`);
      if (again) again.focus();
    });
  }
  const clearFilters = root.querySelector("#filters-clear");
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      state.filters = { ...EMPTY_FILTERS };
      render();
    });
  }
  const tokenSave = root.querySelector("#admin-token-save");
  if (tokenSave) {
    tokenSave.addEventListener("click", async () => {
      setAdminToken(root.querySelector("#admin-token").value.trim());
      await loadRecords();
      render();
    });
  }

  const filtered = hasActiveFilters(state.filters);
  const scope = filtered ? "filtered" : "all";
  const bind = (id, fn) => {
    const el = root.querySelector(`#${id}`);
    if (el) el.addEventListener("click", fn);
  };
  bind("export-csv", () => exportRecords(visibleRecords(), scope, "csv"));
  bind("export-json", () => exportRecords(visibleRecords(), scope, "json"));
  bind("export-csv-all", () => exportRecords(state.records, "all", "csv"));
  bind("export-json-all", () => exportRecords(state.records, "all", "json"));
  bind("export-dict", () => downloadText("agecheck-data-dictionary.csv", dictionaryToCSV(), "text/csv"));

  const del = root.querySelector("#delete-form");
  if (del) {
    del.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const code = root.querySelector("#delete-code").value.trim().toUpperCase();
      if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
        state.message = "Enter a response code in the form ABCD-EFGH.";
        render();
        return;
      }
      try {
        const store = currentStore();
        const res = store.kind === "remote" ? await store.deleteByCode(code, getAdminToken()) : await store.deleteByCode(code);
        state.message = res.removed ? `Deleted ${res.removed} record(s) with code ${code}.` : `No record with code ${code} was found.`;
        await loadRecords();
      } catch (err) {
        state.message = `Deletion failed: ${err.message}`;
      }
      render();
    });
  }

  const demoForm = root.querySelector("#demo-form");
  if (demoForm) {
    demoForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const n = Math.max(10, Math.min(500, parseInt(root.querySelector("#demo-count").value, 10) || 40));
      try {
        const store = demoStore();
        await store.clear();
        for (const r of generateDemoRecords(state.activeConfig, n)) await store.save(r);
        state.source = "demo";
        state.filters = { ...EMPTY_FILTERS };
        state.message = `Generated ${n} synthetic demo records.`;
      } catch (err) {
        state.message = `Could not generate demo records: ${err.message}`;
      }
      await loadRecords();
      render();
    });
    root.querySelector("#demo-clear").addEventListener("click", async () => {
      await demoStore().clear();
      state.message = "Demo records cleared.";
      await loadRecords();
      render();
    });
  }

  if (root.querySelector("#config-form")) wireConfig();
}

function wireConfig() {
  const form = root.querySelector("#config-form");
  form.addEventListener("input", () => {
    // Keep the draft current as the researcher types, without re-rendering.
    captureConfigDraft();
    const heading = root.querySelector("h2");
    const badge = root.querySelector("#unsaved-badge");
    if (state.draft && !badge && heading) heading.insertAdjacentHTML("beforeend", ' <span class="unsaved" id="unsaved-badge">Unsaved changes</span>');
    if (!state.draft && badge) badge.remove();
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = readConfigForm();
    const problems = validateConfig(c);
    state.message = null;
    if (problems.length) {
      state.problems = { title: "Not saved. Fix these first:", list: problems };
      render();
      return;
    }
    setSaved(c);
    state.problems = null;
    state.message = "Saved to this browser. The participant app in this browser will use it unless a study.config.json file is served.";
    render();
  });

  root.querySelector("#cfg-check").addEventListener("click", () => {
    const c = isFrozen() ? state.config : readConfigForm();
    state.problems = { title: "Not ready for activation:", list: activationProblems(c) };
    state.message = null;
    render(); // the form is rebuilt from the draft, so nothing typed is lost
    const box = root.querySelector("#config-problems");
    if (box) box.scrollIntoView({ block: "nearest" });
  });

  const act = root.querySelector("#cfg-activate");
  if (act) {
    act.addEventListener("click", () => {
      const c = readConfigForm();
      const candidate = { ...c, mode: "research", frozen: true, activatedOn: new Date().toISOString().slice(0, 10) };
      const problems = activationProblems(candidate);
      state.message = null;
      if (problems.length) {
        state.problems = { title: "Not activated. Research mode needs all of these:", list: problems };
        render();
        return;
      }
      const ok = window.confirm(
        `Activate research mode for study version ${c.studyVersion}?\n\nThe configuration will be frozen. Collection starts only where this configuration is deployed (this browser, a served study.config.json, or the server).`
      );
      if (!ok) return;
      setSaved(candidate);
      state.problems = null;
      state.message = "Research mode activated and frozen in this browser. Deploy the configuration to where participants will use it.";
      render();
    });
  }

  const deact = root.querySelector("#cfg-deactivate");
  if (deact) {
    deact.addEventListener("click", () => {
      const ok = window.confirm("Return to preview mode? Export any research data first. Existing research records stay in their store until you delete them.");
      if (!ok) return;
      setSaved({ ...state.config, mode: "preview", frozen: false });
      state.message = "Back in preview mode. Bump the study version before activating again.";
      state.problems = null;
      render();
    });
  }

  const discard = root.querySelector("#cfg-discard");
  if (discard) {
    discard.addEventListener("click", () => {
      if (!window.confirm("Discard the unsaved changes in this form?")) return;
      // Put the saved values back in the form so the capture before the next render sees no difference.
      state.draft = null;
      clearConfigDraft();
      root.querySelector("#config-form").remove();
      state.problems = null;
      state.message = "Unsaved changes discarded.";
      render();
    });
  }

  root.querySelector("#cfg-download").addEventListener("click", () => {
    const c = isFrozen() ? state.config : readConfigForm();
    downloadText("study.config.json", JSON.stringify(c, null, 2), "application/json");
  });

  const push = root.querySelector("#cfg-push");
  if (push && !push.disabled) {
    push.addEventListener("click", async () => {
      const c = isFrozen() ? state.config : readConfigForm();
      const token = getAdminToken() || window.prompt("Admin token for the server:");
      if (!token) return;
      setAdminToken(token);
      state.problems = null;
      try {
        const store = new RemoteRecordStore({ endpointUrl: c.storage.endpointUrl, submitToken: "" });
        await store.putServerConfig(c, token);
        state.message = "Configuration pushed. The server now serves it as study.config.json.";
      } catch (err) {
        state.message = `Push failed: ${err.message}`;
        if (err.problems && err.problems.length) state.problems = { title: "The server refused the configuration:", list: err.problems };
      }
      render();
    });
  }

  root.querySelector("#cfg-reset").addEventListener("click", () => {
    if (!window.confirm("Reset the configuration in this browser to the defaults?")) return;
    clearLocalConfig();
    clearConfigDraft();
    state.config = cloneConfig(DEFAULT_STUDY_CONFIG);
    state.draft = null;
    root.querySelector("#config-form").remove();
    state.message = "Reset to defaults.";
    state.problems = null;
    refreshActive();
    render();
  });

  root.querySelector("#cfg-import-btn").addEventListener("click", () => {
    const pasted = root.querySelector("#cfg-import").value;
    state.message = null;
    state.problems = null;
    let json;
    try {
      json = JSON.parse(pasted);
    } catch {
      state.problems = { title: "Not imported. The pasted text is not valid JSON.", list: ["Paste the whole contents of a study.config.json file."] };
      render();
      return;
    }
    const parsed = parseConfig(json);
    const structure = parsed.config ? validateConfig(parsed.config) : parsed.problems;
    if (!parsed.config || structure.length) {
      state.problems = { title: "Not imported. The configuration is not valid:", list: structure };
      render();
      return;
    }
    let config = parsed.config;
    if (config.mode === "research" && parsed.problems.length) {
      // Never let a research-mode configuration in through the side door.
      config = { ...config, mode: "preview", frozen: false, activatedOn: null };
      state.problems = { title: "Imported in preview mode, because it does not pass the research-mode checks:", list: parsed.problems };
    } else {
      state.message = "Imported and saved to this browser.";
    }
    root.querySelector("#config-form").remove();
    setSaved(config);
    render();
  });
}

function refreshActive() {
  if (state.activeSource === "file") return;
  const local = loadLocalConfig();
  state.activeConfig = (local && local.config) || cloneConfig(DEFAULT_STUDY_CONFIG);
  state.activeSource = local ? "local" : "default";
  state.activeProblems = local ? local.problems : [];
  if (state.source === "research" && !researchAvailable()) state.source = "demo";
}

async function init() {
  const resolved = await resolveConfig();
  state.activeConfig = resolved.config;
  state.activeSource = resolved.source;
  state.activeProblems = resolved.problems;
  const local = loadLocalConfig();
  state.config = (local && local.config) || (resolved.source === "file" ? cloneConfig(resolved.config) : cloneConfig(DEFAULT_STUDY_CONFIG));
  const draft = loadConfigDraft();
  if (draft && state.config.mode !== "research") {
    const merged = mergeConfig(draft);
    if (JSON.stringify(merged) !== JSON.stringify(state.config)) state.draft = merged;
  }
  await loadRecords();
  render();
}

init().catch((err) => {
  root.innerHTML = `<section class="card"><h1>Something went wrong</h1><p>${esc(err.message || err)}</p></section>`;
});
