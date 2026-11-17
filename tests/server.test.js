// Tests for the reference server: configuration gate, validation, tokens,
// record precedence, the withdrawal policy, freezing, and static serving.
// Run with: npm test

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startServer } from "../server/server.js";
import * as E from "../src/engine.js";
import { DEFAULT_STUDY_CONFIG, cloneConfig } from "../src/study-config.js";
import { SPECIAL, validateRecord } from "../src/data-dictionary.js";

const SUBMIT = "submit-token-for-tests-0123456789";
const ADMIN = "admin-token-for-tests-0123456789";

function researchConfig(overrides = {}) {
  const c = cloneConfig(DEFAULT_STUDY_CONFIG);
  c.mode = "research";
  c.frozen = true;
  c.studyVersion = "1.0.0";
  c.storage = { adapter: "remote-endpoint", endpointUrl: "http://127.0.0.1", submitToken: SUBMIT };
  c.withdrawal.retainPartialResponses = false;
  for (const k of Object.keys(c.consent)) {
    if (typeof c.consent[k] === "string") c.consent[k] = c.consent[k].replace(/\[[^\]]*\]/g, "filled");
  }
  Object.assign(c, overrides);
  return c;
}

/** One participant's record at each milestone, built the way the app builds it. */
function stages(cfg = researchConfig()) {
  const s = E.createSession(cfg);
  E.begin(s);
  E.submitEligibility(s, cfg, { ageCategory: "age_16", meetsCriteria: true });
  E.giveAssent(s, cfg);
  E.continueScenario(s);
  E.confirmVerificationDisplayed(s);
  const out = { displayed: E.buildRecord(s, cfg) };
  E.initialDecision(s, "start");
  E.simulationComplete(s);
  out.reached = E.buildRecord(s, cfg);
  E.idDecision(s, "continue");
  out.decided = E.buildRecord(s, cfg);
  E.beginQuestionnaire(s);
  E.submitQuestionnaire(s, { risk_exposure: "4" });
  out.submitted = E.buildRecord(s, cfg);
  E.withdraw(s);
  out.withdrawn = E.buildRecord(s, cfg);
  return out;
}

function researchRecord(overrides = {}) {
  return { ...stages().submitted, ...overrides };
}

/** A server on its own port and data directory, with helpers bound to it. */
async function makeServer({ deploy = null } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agecheck-test-"));
  const server = await startServer({ port: 0, host: "127.0.0.1", submitToken: SUBMIT, adminToken: ADMIN, dataDir, log: () => {} });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (pathname, { method = "GET", body, submit, admin } = {}) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (submit) headers["X-Study-Token"] = submit;
    if (admin) headers.Authorization = `Bearer ${admin}`;
    const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data, headers: res.headers };
  };
  const ctx = {
    base,
    dataDir,
    api,
    submit: (record) => api("/api/submit", { method: "POST", body: record, submit: SUBMIT }),
    records: async () => (await api("/api/admin/records", { admin: ADMIN })).data.records,
    stored: async (id) => (await ctx.records()).filter((r) => r.response_id === id),
    close: async () => {
      await new Promise((r) => server.close(r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  if (deploy) {
    const put = await api("/api/admin/config", { method: "PUT", body: deploy, admin: ADMIN });
    assert.equal(put.status, 200, JSON.stringify(put.data));
  }
  return ctx;
}

describe("static serving", () => {
  let s;
  before(async () => {
    s = await makeServer();
  });
  after(() => s.close());

  test("serves the app with security headers and no camera or microphone permission", async () => {
    const res = await fetch(s.base + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("permissions-policy"), /camera=\(\)/);
    assert.match(res.headers.get("permissions-policy"), /microphone=\(\)/);
    assert.ok(res.headers.get("content-security-policy").includes("default-src 'self'"));
    const html = await res.text();
    assert.ok(html.includes("AgeCheck Study"));
    assert.ok(!html.includes('type="file"'));
  });

  test("serves every module the pages import, and nothing outside the allow list", async () => {
    for (const p of ["/src/app.js", "/src/researcher.js", "/src/summary.js", "/src/storage.js", "/src/engine.js", "/src/study-config.js", "/src/data-dictionary.js", "/styles.css", "/researcher.html"]) {
      assert.equal((await fetch(s.base + p)).status, 200, p);
    }
    for (const p of ["/package.json", "/server/server.js", "/.git/config", "/tests/engine.test.js", "/../package.json"]) {
      assert.equal((await fetch(s.base + p)).status, 404, p);
    }
  });

  test("study.config.json is 404 until a configuration is deployed", async () => {
    assert.equal((await fetch(s.base + "/study.config.json")).status, 404);
  });
});

describe("nothing is accepted until a valid research configuration is deployed", () => {
  let s;
  before(async () => {
    s = await makeServer();
  });
  after(() => s.close());

  test("a correct token and a valid record are still refused with no configuration", async () => {
    const r = await s.submit(researchRecord());
    assert.equal(r.status, 503);
    assert.match(r.data.error, /no study configuration has been deployed/);
    assert.deepEqual(await s.records(), []);
  });

  test("a preview configuration can be deployed but does not open collection", async () => {
    const preview = cloneConfig(DEFAULT_STUDY_CONFIG);
    const put = await s.api("/api/admin/config", { method: "PUT", body: preview, admin: ADMIN });
    assert.equal(put.status, 200);
    const r = await s.submit(researchRecord());
    assert.equal(r.status, 503);
    assert.match(r.data.error, /not a valid research configuration/);
  });

  test("a research configuration is refused while anything required is missing or inconsistent", async () => {
    const cases = [
      ["placeholders left in", (c) => Object.assign(c.consent, cloneConfig(DEFAULT_STUDY_CONFIG).consent), /placeholder/i],
      ["study information emptied", (c) => (c.consent.researcherContact = ""), /Researcher contact is required and is empty/],
      ["withdrawal policy not chosen", (c) => (c.withdrawal.retainPartialResponses = null), /Withdrawal policy must be chosen/],
      ["a draft version", (c) => (c.studyVersion = "1.0.0-draft"), /non-draft/],
      ["storage on the participant's device", (c) => (c.storage.adapter = "local-device"), /must use the remote endpoint/],
      ["a submit token this server would refuse", (c) => (c.storage.submitToken = "a-different-token-0123456789"), /does not match this server/],
      ["a broken questionnaire", (c) => c.questionnaire.items.pop(), /questionnaire\.items/],
      ["an unknown mode", (c) => (c.mode = "live"), /mode must be/],
    ];
    for (const [name, mutate, expected] of cases) {
      const cfg = researchConfig();
      mutate(cfg);
      const put = await s.api("/api/admin/config", { method: "PUT", body: cfg, admin: ADMIN });
      assert.equal(put.status, 422, name);
      assert.ok(put.data.problems.some((p) => expected.test(p)), `${name}: ${JSON.stringify(put.data.problems)}`);
    }
    for (const body of [[], "text", { schemaVersion: 3 }]) {
      const put = await s.api("/api/admin/config", { method: "PUT", body, admin: ADMIN });
      assert.equal(put.status, 400);
    }
    assert.equal((await s.submit(researchRecord())).status, 503);
  });

  test("a configuration file that was edited into an invalid state closes collection again", async () => {
    const t = await makeServer({ deploy: researchConfig() });
    assert.equal((await t.submit(researchRecord())).status, 200);
    const file = path.join(t.dataDir, "config.json");
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    cfg.consent.supervisorContact = "";
    fs.writeFileSync(file, JSON.stringify(cfg));
    const r = await t.submit(researchRecord());
    assert.equal(r.status, 503);
    await t.close();
  });
});

describe("submissions", () => {
  let s;
  before(async () => {
    s = await makeServer({ deploy: researchConfig() });
  });
  after(() => s.close());

  test("the deployed configuration is served to participants", async () => {
    const served = await fetch(s.base + "/study.config.json");
    assert.equal(served.status, 200);
    assert.equal((await served.json()).studyVersion, "1.0.0");
  });

  test("rejects a missing or wrong study token", async () => {
    assert.equal((await s.api("/api/submit", { method: "POST", body: researchRecord() })).status, 401);
    assert.equal((await s.api("/api/submit", { method: "POST", body: researchRecord(), submit: "wrong" })).status, 401);
  });

  test("rejects records that do not match the data dictionary", async () => {
    const r = await s.submit(researchRecord({ condition: "unknown", extra_field: "x" }));
    assert.equal(r.status, 422);
    assert.ok(r.data.problems.some((p) => p.includes("condition")));
    assert.ok(r.data.problems.some((p) => p.includes("extra_field")));
  });

  test("rejects demo records and records from another study version", async () => {
    assert.equal((await s.submit(researchRecord({ record_kind: "synthetic_demo" }))).status, 422);
    assert.equal((await s.submit(researchRecord({ record_kind: "preview_walkthrough" }))).status, 422);
    assert.equal((await s.submit(researchRecord({ study_version: "0.9.0" }))).status, 409);
  });

  test("accepts a valid record once and treats a resend as the same record", async () => {
    const rec = researchRecord();
    const first = await s.submit(rec);
    assert.equal(first.status, 200);
    assert.equal(first.data.outcome, "created");
    assert.equal(first.data.duplicate, false);
    const second = await s.submit(rec);
    assert.equal(second.status, 200);
    assert.equal(second.data.outcome, "unchanged");
    assert.equal(second.data.duplicate, true);
    assert.equal((await s.stored(rec.response_id)).length, 1);
  });

  test("milestones arriving out of order end at the newest one, with one record", async () => {
    const r = stages();
    const outcomes = [];
    for (const rec of [r.reached, r.displayed, r.decided, r.reached, r.submitted, r.decided]) outcomes.push((await s.submit(rec)).data.outcome);
    assert.deepEqual(outcomes, ["created", "superseded", "updated", "superseded", "updated", "superseded"]);
    const [stored] = await s.stored(r.submitted.response_id);
    assert.equal(stored.submission_status, "submitted");
    assert.equal(stored.q_risk_exposure, "4");
    assert.equal((await s.stored(r.submitted.response_id)).length, 1);
  });

  test("concurrent saves for one response leave one record at the newest state", async () => {
    const r = stages();
    await Promise.all([r.displayed, r.reached, r.decided, r.submitted, r.reached, r.displayed].map((rec) => s.submit(rec)));
    const stored = await s.stored(r.submitted.response_id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].submission_status, "submitted");
  });

  test("rejects oversized bodies", async () => {
    const r = await s.submit(researchRecord({ q_open_influence: "x".repeat(40000) }));
    assert.ok(r.status === 413 || r.status === 422);
  });
});

describe("withdrawal precedence and the retention policy", () => {
  test("a withdrawal withdraws the record whether it arrives after or before the submission", async () => {
    const s = await makeServer({ deploy: researchConfig() });
    const a = stages();
    assert.equal((await s.submit(a.submitted)).data.outcome, "created");
    assert.equal((await s.submit(a.withdrawn)).data.outcome, "updated");
    let [stored] = await s.stored(a.submitted.response_id);
    assert.equal(stored.submission_status, "withdrawn");
    assert.equal(stored.q_risk_exposure, SPECIAL.WITHHELD);

    const b = stages();
    await s.submit(b.withdrawn);
    const late = await s.submit(b.submitted);
    assert.equal(late.status, 200); // the browser is not told to retry
    assert.equal(late.data.outcome, "superseded");
    [stored] = await s.stored(b.submitted.response_id);
    assert.equal(stored.submission_status, "withdrawn");
    assert.equal(stored.q_risk_exposure, SPECIAL.WITHHELD);

    // Older progress saves arriving after the withdrawal change nothing either.
    assert.equal((await s.submit(b.reached)).data.outcome, "superseded");
    assert.equal((await s.stored(b.submitted.response_id))[0].submission_status, "withdrawn");
    assert.equal((await s.records()).length, 2);
    await s.close();
  });

  test("the server withholds responses on a withdrawal even when the browser sent them", async () => {
    const s = await makeServer({ deploy: researchConfig() }); // deployed policy: withhold
    const retain = researchConfig();
    retain.withdrawal.retainPartialResponses = true;
    const sent = stages(retain).withdrawn; // built as if the policy were "retain"
    assert.equal(sent.q_risk_exposure, "4");
    assert.equal(sent.id_decision, "continue");
    assert.equal((await s.submit(sent)).status, 200);
    const [stored] = await s.stored(sent.response_id);
    assert.equal(stored.q_risk_exposure, SPECIAL.WITHHELD);
    assert.equal(stored.id_decision, SPECIAL.WITHHELD);
    assert.equal(stored.questionnaire_status, "missing");
    assert.equal(stored.condition, sent.condition);
    assert.equal(stored.withdrawn_at_step, "questionnaire");
    assert.deepEqual(validateRecord(stored), []);
    await s.close();
  });

  test("with the policy set to retain, a withdrawal keeps the partial responses", async () => {
    const retain = researchConfig();
    retain.withdrawal.retainPartialResponses = true;
    const s = await makeServer({ deploy: retain });
    const r = stages(retain);
    await s.submit(r.submitted);
    await s.submit(r.withdrawn);
    const [stored] = await s.stored(r.withdrawn.response_id);
    assert.equal(stored.submission_status, "withdrawn");
    assert.equal(stored.final_pathway, "withdrawn");
    assert.equal(stored.id_decision, "continue");
    assert.equal(stored.q_risk_exposure, "4");
    await s.close();
  });

  test("an unreadable record file is an error and is not overwritten", async () => {
    const s = await makeServer({ deploy: researchConfig() });
    await s.submit(researchRecord());
    const file = path.join(s.dataDir, "records.json");
    fs.writeFileSync(file, "{broken");
    const r = await s.submit(researchRecord());
    assert.equal(r.status, 500);
    assert.match(r.data.error, /could not be read/);
    assert.equal(fs.readFileSync(file, "utf8"), "{broken");
    assert.equal((await s.api("/api/admin/records", { admin: ADMIN })).status, 500);
    await s.close();
  });
});

describe("administration", () => {
  let s;
  before(async () => {
    s = await makeServer({ deploy: researchConfig() });
  });
  after(() => s.close());

  test("admin endpoints require the admin token", async () => {
    assert.equal((await s.api("/api/admin/records")).status, 401);
    assert.equal((await s.api("/api/admin/records", { admin: SUBMIT })).status, 401);
    assert.equal((await s.api("/api/admin/records", { admin: ADMIN })).status, 200);
    assert.equal((await s.api("/api/admin/config", { method: "PUT", body: researchConfig(), admin: SUBMIT })).status, 401);
  });

  test("deletes by response code", async () => {
    const rec = researchRecord();
    await s.submit(rec);
    const del = await s.api(`/api/admin/records/${rec.response_code}`, { method: "DELETE", admin: ADMIN });
    assert.equal(del.status, 200);
    assert.equal(del.data.removed, 1);
    const again = await s.api(`/api/admin/records/${rec.response_code}`, { method: "DELETE", admin: ADMIN });
    assert.equal(again.data.removed, 0);
  });

  test("the configuration freezes once research records exist", async () => {
    const ok = await s.submit(researchRecord());
    assert.equal(ok.status, 200);
    const next = researchConfig({ studyVersion: "1.1.0" });
    const frozen = await s.api("/api/admin/config", { method: "PUT", body: next, admin: ADMIN });
    assert.equal(frozen.status, 409);
    assert.match(frozen.data.error, /frozen/);
    assert.equal((await (await fetch(s.base + "/study.config.json")).json()).studyVersion, "1.0.0");
  });
});
