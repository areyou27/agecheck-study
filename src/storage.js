// Storage for AgeCheck Study.
//
// Three kinds of record store, chosen from the study configuration:
//   demo            preview mode. Synthetic records and walkthrough runs,
//                   kept in this browser's localStorage under a demo key.
//   local-device    research mode. Records kept in this browser's
//                   localStorage on this device only. Participants on other
//                   devices are NOT collected. Use for in-person sessions on
//                   a researcher-controlled device, and export regularly.
//   remote-endpoint research mode. Records are POSTed to the reference
//                   server in server/ (or a compatible service), which
//                   validates them and keeps them outside the frontend.
//
// Demo and research records never share a key, a store, or an export, and
// each store refuses records of the other kind.
//
// Every store follows the same rule when a record arrives for a response it
// already holds (resolveSave in data-dictionary.js): newer progress replaces
// older, a late save never undoes newer progress, and a withdrawal replaces
// everything and is replaced by nothing.

import { parseConfig, mergeConfig, retainsPartialResponses } from "./study-config.js";
import { resolveSave } from "./data-dictionary.js";

export const KEYS = {
  config: "agecheck.config.v1",
  configDraft: "agecheck.config.draft.v1",
  demoRecords: "agecheck.demo.records.v1",
  researchRecords: "agecheck.research.records.v1",
  session: "agecheck.session.v1",
  drafts: "agecheck.drafts.v1",
  adminToken: "agecheck.admin.token.v1",
};

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function readJson(storage, key, fallback) {
  const raw = safeGet(storage, key);
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Configuration

/**
 * The configuration saved in this browser by the researcher dashboard, or
 * null when there is none. Returns { config, problems }: config is null when
 * what is stored cannot be read as a configuration at all.
 */
export function loadLocalConfig() {
  const raw = safeGet(globalThis.localStorage, KEYS.config);
  if (!raw) return null;
  try {
    return parseConfig(JSON.parse(raw));
  } catch {
    return { config: null, problems: ["The configuration saved in this browser could not be read."] };
  }
}

export function saveLocalConfig(config) {
  return safeSet(globalThis.localStorage, KEYS.config, JSON.stringify(config));
}

export function clearLocalConfig() {
  safeRemove(globalThis.localStorage, KEYS.config);
}

/**
 * Resolve the active configuration.
 *   1. study.config.json next to the page (a deployed, frozen configuration,
 *      or one served by the reference server)
 *   2. this browser's saved configuration (set in the researcher dashboard)
 *   3. the built-in defaults (preview mode)
 *
 * Returns { config, source, problems }. Whatever its source, the
 * configuration is validated before use. When problems is not empty the app
 * must not run participants: it does not fall back to another source, because
 * that would hide a broken deployment.
 */
export async function resolveConfig({ fetchImpl = globalThis.fetch } = {}) {
  if (fetchImpl) {
    let res = null;
    try {
      res = await fetchImpl("./study.config.json", { cache: "no-store" });
    } catch {
      res = null; // no file reachable; fall through
    }
    if (res && res.ok) {
      let json;
      try {
        json = await res.json();
      } catch {
        return { config: mergeConfig(null), source: "file", problems: ["The served study.config.json is not valid JSON."] };
      }
      const parsed = parseConfig(json);
      return { config: parsed.config || mergeConfig(null), source: "file", problems: parsed.problems };
    }
  }
  const local = loadLocalConfig();
  if (local) return { config: local.config || mergeConfig(null), source: "local", problems: local.problems };
  return { config: mergeConfig(null), source: "default", problems: [] };
}

// ---------------------------------------------------------------------------
// Participant session and unfinished answers (per tab, cleared when the tab closes)

export function loadSessionJson() {
  return safeGet(globalThis.sessionStorage, KEYS.session);
}

export function saveSessionJson(json) {
  return safeSet(globalThis.sessionStorage, KEYS.session, json);
}

export function clearSession() {
  safeRemove(globalThis.sessionStorage, KEYS.session);
}

/**
 * Drafts are answers typed or selected but not yet submitted: the eligibility
 * form, the assent checkbox, and the questionnaire. They live only in this
 * tab's session storage, separate from the session and from any record, so a
 * refresh, the Back button, or a dialog cannot lose them. They are never sent
 * anywhere and never become part of a record unless the participant submits.
 */
export function loadDrafts() {
  return readJson(globalThis.sessionStorage, KEYS.drafts, {});
}

export function saveDrafts(drafts) {
  return safeSet(globalThis.sessionStorage, KEYS.drafts, JSON.stringify(drafts || {}));
}

export function clearDrafts() {
  safeRemove(globalThis.sessionStorage, KEYS.drafts);
}

/** Unsaved edits in the researcher dashboard's configuration form (this tab only). */
export function loadConfigDraft() {
  return readJson(globalThis.sessionStorage, KEYS.configDraft, null);
}

export function saveConfigDraft(config) {
  return safeSet(globalThis.sessionStorage, KEYS.configDraft, JSON.stringify(config));
}

export function clearConfigDraft() {
  safeRemove(globalThis.sessionStorage, KEYS.configDraft);
}

// ---------------------------------------------------------------------------
// Record stores

const DEMO_KINDS = ["preview_walkthrough", "synthetic_demo"];
const RESEARCH_KINDS = ["research"];

export class LocalRecordStore {
  /**
   * options.kinds            record kinds this store accepts
   * options.studyVersion     when set, only records of this study version are accepted
   * options.retainWithdrawn  false withholds responses on any withdrawn record before storing it
   */
  constructor(key, label, options = {}) {
    this.key = key;
    this.label = label;
    this.kind = "local";
    this.kinds = options.kinds || DEMO_KINDS;
    this.studyVersion = options.studyVersion || null;
    this.retainWithdrawn = options.retainWithdrawn;
  }

  describe() {
    return `${this.label}: records are kept in this browser's local storage on this device only. They are not shared across devices or browsers, and clearing site data removes them. Export regularly.`;
  }

  _read() {
    let raw;
    try {
      raw = globalThis.localStorage.getItem(this.key);
    } catch {
      throw new Error("This browser is blocking its local storage, so records cannot be read or saved.");
    }
    if (!raw) return {};
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      // Never treat unreadable records as "no records": the next save would overwrite them.
      throw new Error("The records stored in this browser could not be read. Nothing was changed.");
    }
    return obj;
  }

  _write(map) {
    if (!safeSet(globalThis.localStorage, this.key, JSON.stringify(map))) {
      throw new Error("This browser refused to store the record (storage may be full or disabled).");
    }
  }

  _check(record) {
    if (!record || typeof record !== "object" || typeof record.response_id !== "string") {
      throw new Error("That is not a record.");
    }
    if (!this.kinds.includes(record.record_kind)) {
      throw new Error(`A "${record.record_kind}" record does not belong with ${this.label.toLowerCase()} records.`);
    }
    if (this.studyVersion && record.study_version !== this.studyVersion) {
      throw new Error(`This record is for study version ${record.study_version}, not ${this.studyVersion}.`);
    }
  }

  async list() {
    return Object.values(this._read());
  }

  /**
   * Save by response_id. Returns { ok, outcome, duplicate } where outcome is
   * created, updated, unchanged, or superseded (see resolveSave). Repeated or
   * late saves never create a second record and never undo newer progress.
   */
  async save(record) {
    this._check(record);
    const map = this._read();
    const decision = resolveSave(map[record.response_id], record, { retainWithdrawn: this.retainWithdrawn });
    if (decision.outcome === "created" || decision.outcome === "updated") {
      map[record.response_id] = decision.record;
      this._write(map);
    }
    return { ok: true, outcome: decision.outcome, duplicate: decision.outcome !== "created" };
  }

  async deleteByCode(code) {
    const map = this._read();
    const wanted = String(code || "").trim().toUpperCase();
    let removed = 0;
    for (const [id, rec] of Object.entries(map)) {
      if (rec.response_code === wanted) {
        delete map[id];
        removed += 1;
      }
    }
    if (removed) this._write(map);
    return { removed };
  }

  async clear() {
    safeRemove(globalThis.localStorage, this.key);
  }
}

export class RemoteRecordStore {
  constructor({ endpointUrl, submitToken, fetchImpl }) {
    this.base = String(endpointUrl || "").replace(/\/+$/, "");
    this.submitToken = submitToken || "";
    this.fetchImpl = fetchImpl || null;
    this.kind = "remote";
  }

  describe() {
    return `Remote endpoint: records are sent to ${this.base}/api/submit and stored by that server. Collection works across devices as long as the server is reachable. The server operator controls access, retention, and what the hosting provider logs (including IP addresses).`;
  }

  async _request(path, { method = "GET", body, adminToken } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.submitToken && path === "/api/submit") headers["X-Study-Token"] = this.submitToken;
    if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
    const doFetch = this.fetchImpl || globalThis.fetch.bind(globalThis);
    let res;
    try {
      res = await doFetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new Error("The server could not be reached. Check your connection and try again.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = data && data.error ? data.error : `The server responded with status ${res.status}.`;
      const err = new Error(msg);
      err.status = res.status;
      err.problems = data && Array.isArray(data.problems) ? data.problems : [];
      throw err;
    }
    return data || {};
  }

  async save(record) {
    const data = await this._request("/api/submit", { method: "POST", body: record });
    return { ok: true, outcome: data.outcome || (data.duplicate ? "unchanged" : "created"), duplicate: Boolean(data.duplicate) };
  }

  async list(adminToken) {
    const data = await this._request("/api/admin/records", { adminToken });
    return Array.isArray(data.records) ? data.records : [];
  }

  async deleteByCode(code, adminToken) {
    const wanted = encodeURIComponent(String(code || "").trim().toUpperCase());
    return this._request(`/api/admin/records/${wanted}`, { method: "DELETE", adminToken });
  }

  async getServerConfig(adminToken) {
    return this._request("/api/admin/config", { adminToken });
  }

  async putServerConfig(config, adminToken) {
    return this._request("/api/admin/config", { method: "PUT", body: config, adminToken });
  }
}

/** Demo records: preview walkthroughs and synthetic data. Never research records. */
export function demoStore(config) {
  return new LocalRecordStore(KEYS.demoRecords, "Preview (demo) storage", {
    kinds: DEMO_KINDS,
    retainWithdrawn: config ? retainsPartialResponses(config) : undefined,
  });
}

/** Research records kept on this device, for the given research configuration. */
export function localResearchStore(config) {
  return new LocalRecordStore(KEYS.researchRecords, "Local-device research storage", {
    kinds: RESEARCH_KINDS,
    studyVersion: config ? config.studyVersion : null,
    retainWithdrawn: config ? retainsPartialResponses(config) : undefined,
  });
}

/** The store the participant app writes to for the active configuration. */
export function participantStore(config, { fetchImpl } = {}) {
  if (config.mode !== "research") return demoStore(config);
  const s = config.storage || {};
  if (s.adapter === "remote-endpoint") {
    return new RemoteRecordStore({ endpointUrl: s.endpointUrl, submitToken: s.submitToken, fetchImpl });
  }
  if (s.adapter === "local-device") return localResearchStore(config);
  return null; // research mode without storage: collection is disabled
}

// ---------------------------------------------------------------------------
// Admin token for the dashboard (session only, never written to the page)

export function getAdminToken() {
  return safeGet(globalThis.sessionStorage, KEYS.adminToken) || "";
}

export function setAdminToken(token) {
  if (!token) safeRemove(globalThis.sessionStorage, KEYS.adminToken);
  else safeSet(globalThis.sessionStorage, KEYS.adminToken, token);
}
