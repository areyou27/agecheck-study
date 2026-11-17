// Tests for the browser-side stores, drafts, configuration loading, and the
// dashboard's summary arithmetic. Run with: npm test   (node --test)

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// In-memory stand-ins for the browser's storage, installed before the modules use them.
function memoryStorage() {
  const map = new Map();
  return {
    failWrites: false,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (this.failWrites) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    keys: () => [...map.keys()],
  };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

const E = await import("../src/engine.js");
const { DEFAULT_STUDY_CONFIG, cloneConfig } = await import("../src/study-config.js");
const { SPECIAL, validateRecord } = await import("../src/data-dictionary.js");
const S = await import("../src/storage.js");
const { filterRecords, hasActiveFilters, studyVersions, summarize, summarizeGroup, formatRate, rate } = await import("../src/summary.js");

function previewConfig() {
  return cloneConfig(DEFAULT_STUDY_CONFIG);
}

function researchConfig(overrides = {}) {
  const c = previewConfig();
  c.mode = "research";
  c.frozen = true;
  c.studyVersion = "1.0.0";
  c.storage = { adapter: "local-device", endpointUrl: "", submitToken: "" };
  c.withdrawal.retainPartialResponses = false;
  for (const k of Object.keys(c.consent)) {
    if (typeof c.consent[k] === "string") c.consent[k] = c.consent[k].replace(/\[[^\]]*\]/g, "filled");
  }
  Object.assign(c, overrides);
  return c;
}

/** One participant's record at each milestone, in order. */
function stages(cfg, { route = "continue", condition = null } = {}) {
  const s = E.createSession(cfg);
  E.begin(s);
  E.submitEligibility(s, cfg, { ageCategory: "age_16", meetsCriteria: true });
  E.giveAssent(s, cfg, { forcedCondition: condition });
  const out = { assigned: E.buildRecord(s, cfg) };
  E.continueScenario(s);
  E.confirmVerificationDisplayed(s);
  out.displayed = E.buildRecord(s, cfg);
  if (route === "decline") {
    E.initialDecision(s, "decline");
    out.decided = E.buildRecord(s, cfg);
  } else {
    E.initialDecision(s, "start");
    out.started = E.buildRecord(s, cfg);
    E.simulationComplete(s);
    out.reached = E.buildRecord(s, cfg);
    E.idDecision(s, route);
    out.decided = E.buildRecord(s, cfg);
  }
  E.beginQuestionnaire(s);
  E.submitQuestionnaire(s, { risk_exposure: "4", recall_notice: "no" });
  out.submitted = E.buildRecord(s, cfg);
  E.withdraw(s);
  out.withdrawn = E.buildRecord(s, cfg);
  return out;
}

async function only(store, id) {
  const all = (await store.list()).filter((r) => r.response_id === id);
  assert.equal(all.length, 1, "exactly one record per response");
  return all[0];
}

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  globalThis.localStorage.failWrites = false;
});

describe("local stores: withdrawal and ordering", () => {
  test("a withdrawal that arrives after the submitted record still withdraws it", async () => {
    const cfg = researchConfig();
    const r = stages(cfg);
    const store = S.localResearchStore(cfg);
    assert.equal((await store.save(r.submitted)).outcome, "created");
    assert.equal((await store.save(r.withdrawn)).outcome, "updated");
    const stored = await only(store, r.submitted.response_id);
    assert.equal(stored.submission_status, "withdrawn");
    assert.equal(stored.q_risk_exposure, SPECIAL.WITHHELD);
  });

  test("a submission that arrives after the withdrawal does not undo it", async () => {
    const cfg = researchConfig();
    const r = stages(cfg);
    const store = S.localResearchStore(cfg);
    await store.save(r.withdrawn);
    const late = await store.save(r.submitted);
    assert.equal(late.outcome, "superseded");
    assert.equal(late.ok, true); // the sender is not told to retry
    const stored = await only(store, r.submitted.response_id);
    assert.equal(stored.submission_status, "withdrawn");
    assert.equal(stored.q_risk_exposure, SPECIAL.WITHHELD);
  });

  test("older progress arriving late never replaces newer progress, and nothing is duplicated", async () => {
    const cfg = researchConfig();
    const r = stages(cfg);
    const store = S.localResearchStore(cfg);
    for (const rec of [r.assigned, r.reached, r.displayed, r.started, r.reached, r.reached]) await store.save(rec);
    let stored = await only(store, r.assigned.response_id);
    assert.equal(stored.reached_id_prompt, "yes");
    assert.equal(stored.assigned_screen_displayed, "yes");
    await store.save(r.submitted);
    assert.equal((await store.save(r.decided)).outcome, "superseded");
    stored = await only(store, r.assigned.response_id);
    assert.equal(stored.submission_status, "submitted");
    assert.equal((await store.list()).length, 1);
  });

  test("the store applies the withholding policy to a withdrawal even if the record arrives with answers", async () => {
    const retain = researchConfig();
    retain.withdrawal.retainPartialResponses = true;
    const sentWithAnswers = stages(retain).withdrawn;
    assert.equal(sentWithAnswers.q_risk_exposure, "4");
    const store = S.localResearchStore(researchConfig()); // policy: withhold
    await store.save(sentWithAnswers);
    const stored = await only(store, sentWithAnswers.response_id);
    assert.equal(stored.q_risk_exposure, SPECIAL.WITHHELD);
    assert.equal(stored.id_decision, SPECIAL.WITHHELD);
    assert.deepEqual(validateRecord(stored), []);
    // Under the retain policy the same record is kept as sent.
    globalThis.localStorage.clear();
    const keeping = S.localResearchStore(retain);
    await keeping.save(sentWithAnswers);
    assert.equal((await only(keeping, sentWithAnswers.response_id)).q_risk_exposure, "4");
  });
});

describe("local stores: demo and research data stay apart", () => {
  test("the research store refuses preview and synthetic records", async () => {
    const preview = stages(previewConfig()).submitted;
    assert.equal(preview.record_kind, "preview_walkthrough");
    const store = S.localResearchStore(researchConfig());
    await assert.rejects(() => store.save(preview), /does not belong/);
    await assert.rejects(() => store.save({ ...preview, record_kind: "synthetic_demo" }), /does not belong/);
    assert.deepEqual(await store.list(), []);
  });

  test("the demo store refuses research records", async () => {
    const research = stages(researchConfig()).submitted;
    const store = S.demoStore(previewConfig());
    await assert.rejects(() => store.save(research), /does not belong/);
    assert.deepEqual(await store.list(), []);
  });

  test("the research store refuses records from another study version", async () => {
    const v1 = stages(researchConfig()).submitted;
    const store = S.localResearchStore(researchConfig({ studyVersion: "1.1.0" }));
    await assert.rejects(() => store.save(v1), /study version 1\.0\.0, not 1\.1\.0/);
  });

  test("the participant store is chosen by mode and storage, and is absent when research storage is not set", () => {
    assert.equal(S.participantStore(previewConfig()).key, S.KEYS.demoRecords);
    assert.equal(S.participantStore(researchConfig()).key, S.KEYS.researchRecords);
    const remote = researchConfig();
    remote.storage = { adapter: "remote-endpoint", endpointUrl: "https://example.test/", submitToken: "t".repeat(32) };
    assert.equal(S.participantStore(remote).kind, "remote");
    const none = researchConfig();
    none.storage.adapter = "none";
    assert.equal(S.participantStore(none), null);
  });
});

describe("local stores: failures are reported, not hidden", () => {
  test("a refused write rejects with a clear message", async () => {
    const cfg = researchConfig();
    const store = S.localResearchStore(cfg);
    globalThis.localStorage.failWrites = true;
    await assert.rejects(() => store.save(stages(cfg).submitted), /refused to store the record/);
    globalThis.localStorage.failWrites = false;
    assert.deepEqual(await store.list(), []);
  });

  test("unreadable stored records are an error and are never overwritten", async () => {
    const cfg = researchConfig();
    globalThis.localStorage.setItem(S.KEYS.researchRecords, "{not json");
    const store = S.localResearchStore(cfg);
    await assert.rejects(() => store.save(stages(cfg).submitted), /could not be read/);
    await assert.rejects(() => store.list(), /could not be read/);
    assert.equal(globalThis.localStorage.getItem(S.KEYS.researchRecords), "{not json");
  });

  test("deletion by response code removes exactly that record", async () => {
    const cfg = researchConfig();
    const a = stages(cfg).submitted;
    const b = stages(cfg).submitted;
    const store = S.localResearchStore(cfg);
    await store.save(a);
    await store.save(b);
    assert.deepEqual(await store.deleteByCode(a.response_code.toLowerCase()), { removed: 1 });
    assert.deepEqual((await store.list()).map((r) => r.response_id), [b.response_id]);
    assert.deepEqual(await store.deleteByCode("ZZZZ-ZZZZ"), { removed: 0 });
  });

  test("the remote store reports the server's own message and unreachable servers", async () => {
    const record = stages(researchConfig()).submitted;
    const refusing = new S.RemoteRecordStore({
      endpointUrl: "https://example.test",
      submitToken: "t",
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: "This server is not accepting records." }) }),
    });
    await assert.rejects(() => refusing.save(record), /not accepting records/);
    const down = new S.RemoteRecordStore({
      endpointUrl: "https://example.test",
      submitToken: "t",
      fetchImpl: async () => {
        throw new TypeError("network");
      },
    });
    await assert.rejects(() => down.save(record), /could not be reached/);
    const ok = new S.RemoteRecordStore({
      endpointUrl: "https://example.test/",
      submitToken: "t",
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://example.test/api/submit");
        assert.equal(init.headers["X-Study-Token"], "t");
        return { ok: true, status: 200, json: async () => ({ ok: true, outcome: "superseded", duplicate: true }) };
      },
    });
    assert.deepEqual(await ok.save(record), { ok: true, outcome: "superseded", duplicate: true });
  });
});

describe("drafts", () => {
  test("drafts are kept in the tab's session storage, apart from the session and from records", () => {
    assert.deepEqual(S.loadDrafts(), {});
    S.saveSessionJson('{"schema":2}');
    S.saveDrafts({ questionnaire: { risk_exposure: "4", stop_reasons: ["other"] }, consent: { assent: true } });
    assert.deepEqual(S.loadDrafts().questionnaire, { risk_exposure: "4", stop_reasons: ["other"] });
    assert.deepEqual(globalThis.sessionStorage.keys().sort(), [S.KEYS.drafts, S.KEYS.session].sort());
    assert.deepEqual(globalThis.localStorage.keys(), []); // never written next to the records
    S.clearDrafts();
    assert.deepEqual(S.loadDrafts(), {});
    assert.equal(S.loadSessionJson(), '{"schema":2}'); // clearing drafts leaves the session alone
  });

  test("unreadable drafts are treated as none", () => {
    globalThis.sessionStorage.setItem(S.KEYS.drafts, "][");
    assert.deepEqual(S.loadDrafts(), {});
  });

  test("the dashboard's unsaved configuration edits are kept per tab", () => {
    assert.equal(S.loadConfigDraft(), null);
    const edited = previewConfig();
    edited.consent.researcherContact = "Typed but not saved";
    S.saveConfigDraft(edited);
    assert.equal(S.loadConfigDraft().consent.researcherContact, "Typed but not saved");
    assert.equal(S.loadLocalConfig(), null); // a draft is not a saved configuration
    S.clearConfigDraft();
    assert.equal(S.loadConfigDraft(), null);
  });
});

describe("configuration loading", () => {
  const served = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 404, json: async () => body });

  test("with nothing served or saved, the defaults load in preview mode", async () => {
    const r = await S.resolveConfig({ fetchImpl: served(null, false) });
    assert.equal(r.source, "default");
    assert.equal(r.config.mode, "preview");
    assert.deepEqual(r.problems, []);
  });

  test("a valid served research configuration is used", async () => {
    const r = await S.resolveConfig({ fetchImpl: served(researchConfig()) });
    assert.equal(r.source, "file");
    assert.equal(r.config.mode, "research");
    assert.deepEqual(r.problems, []);
  });

  test("a served research configuration with emptied study information is reported, not used and not bypassed", async () => {
    const bad = researchConfig();
    bad.consent.researcherContact = "";
    bad.consent.storageAndAccess = " ";
    S.saveLocalConfig(researchConfig()); // a good saved copy must not paper over the bad deployment
    const r = await S.resolveConfig({ fetchImpl: served(bad) });
    assert.equal(r.source, "file");
    assert.equal(r.problems.length, 2);
  });

  test("a served file that is not a configuration is reported", async () => {
    for (const body of [{ schemaVersion: 7 }, [], "text", { schemaVersion: 1, mode: "research" }]) {
      const r = await S.resolveConfig({ fetchImpl: served(body) });
      assert.equal(r.source, "file");
      assert.ok(r.problems.length > 0, JSON.stringify(body));
    }
    const notJson = await S.resolveConfig({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad");
        },
      }),
    });
    assert.deepEqual(notJson.problems, ["The served study.config.json is not valid JSON."]);
  });

  test("the configuration saved in this browser is checked the same way", async () => {
    const notServed = served(null, false);
    S.saveLocalConfig(researchConfig());
    let r = await S.resolveConfig({ fetchImpl: notServed });
    assert.equal(r.source, "local");
    assert.deepEqual(r.problems, []);

    const emptied = researchConfig();
    emptied.consent.withdrawal = "";
    S.saveLocalConfig(emptied);
    r = await S.resolveConfig({ fetchImpl: notServed });
    assert.equal(r.problems.length, 1);

    const structure = previewConfig();
    structure.questionnaire.items = [];
    S.saveLocalConfig(structure);
    r = await S.resolveConfig({ fetchImpl: notServed });
    assert.ok(r.problems.some((p) => p.includes("questionnaire.items")));

    globalThis.localStorage.setItem(S.KEYS.config, "{broken");
    r = await S.resolveConfig({ fetchImpl: notServed });
    assert.equal(r.source, "local");
    assert.deepEqual(r.problems, ["The configuration saved in this browser could not be read."]);
  });
});

describe("dashboard summary", () => {
  function record(cfg, route, { condition, withdraw = false, submit = true }) {
    const r = stages(cfg, { route, condition });
    if (withdraw) return r.withdrawn;
    return submit ? r.submitted : r.decided;
  }

  test("'excluding withdrawn' takes numerator and denominator from the same non-withdrawn records", () => {
    // Policy: keep partial responses, so a withdrawn record still says id_decision = continue.
    const cfg = previewConfig();
    cfg.withdrawal.retainPartialResponses = true;
    const adv = "advance_notice";
    const records = [
      record(cfg, "continue", { condition: adv }),
      record(cfg, "stop", { condition: adv }),
      record(cfg, "continue", { condition: adv, withdraw: true }),
    ];
    assert.equal(records[2].id_decision, "continue");
    assert.equal(records[2].final_pathway, "withdrawn");
    const s = summarize(records).byCondition[adv];
    assert.equal(s.assigned, 3);
    assert.equal(s.withdrawn, 1);
    assert.equal(s.eligible, 2);
    assert.equal(s.continued, 1); // the withdrawn participant is not counted as continuing
    assert.deepEqual(s.rates.continuedExcludingWithdrawn, { numerator: 1, denominator: 2, percent: 50 });
    assert.equal(formatRate(s.rates.continuedExcludingWithdrawn), "1 / 2 (50.0%)");
    assert.equal(formatRate(s.rates.continuedAmongAssigned), "1 / 3 (33.3%)");
    assert.equal(s.started, 2);
    assert.equal(s.reachedId, 2);
    assert.equal(formatRate(s.rates.continuedAmongReached), "1 / 2 (50.0%)");
  });

  test("the same counts come out whichever withdrawal policy wrote the records", () => {
    const build = (retain) => {
      const cfg = previewConfig();
      cfg.withdrawal.retainPartialResponses = retain;
      const c = "later_notice";
      return summarizeGroup([
        record(cfg, "continue", { condition: c }),
        record(cfg, "decline", { condition: c }),
        record(cfg, "continue", { condition: c, withdraw: true }),
        record(cfg, "stop", { condition: c, withdraw: true }),
      ]);
    };
    assert.deepEqual(build(true), build(false));
  });

  test("empty groups read 'no records' instead of 0% or NaN", () => {
    const s = summarize([]);
    for (const c of Object.keys(s.byCondition)) {
      for (const r of Object.values(s.byCondition[c].rates)) {
        assert.equal(r.percent, null);
        assert.equal(formatRate(r), "no records");
      }
    }
    // A condition whose every participant withdrew has nobody left to exclude from.
    const cfg = previewConfig();
    const all = [record(cfg, "continue", { condition: "advance_notice", withdraw: true })];
    const g = summarize(all).byCondition.advance_notice;
    assert.equal(formatRate(g.rates.continuedExcludingWithdrawn), "no records");
    assert.equal(formatRate(g.rates.continuedAmongAssigned), "0 / 1 (0.0%)");
    assert.deepEqual(rate(0, 0), { numerator: 0, denominator: 0, percent: null });
  });

  test("filters narrow by condition, pathway, status, and study version, and combine", () => {
    const v1 = previewConfig();
    const v2 = previewConfig();
    v2.studyVersion = "2.0.0-draft";
    const records = [
      record(v1, "continue", { condition: "advance_notice" }),
      record(v1, "stop", { condition: "later_notice" }),
      record(v1, "decline", { condition: "later_notice", submit: false }),
      record(v2, "continue", { condition: "later_notice", withdraw: true }),
    ];
    assert.equal(filterRecords(records, {}).length, 4);
    assert.equal(filterRecords(records, { condition: "later_notice" }).length, 3);
    assert.equal(filterRecords(records, { pathway: "withdrawn" }).length, 1);
    assert.equal(filterRecords(records, { status: "in_progress" }).length, 1);
    assert.equal(filterRecords(records, { version: "2.0.0-draft" }).length, 1);
    assert.equal(filterRecords(records, { condition: "later_notice", status: "submitted" }).length, 1);
    assert.equal(filterRecords(records, { condition: "advance_notice", pathway: "withdrawn" }).length, 0);
    assert.deepEqual(studyVersions(records), ["1.0.0-draft", "2.0.0-draft"]);
    assert.equal(hasActiveFilters({ condition: "", pathway: "", status: "", version: "" }), false);
    assert.equal(hasActiveFilters({ version: "2.0.0-draft" }), true);
  });
});
