// Versioned study configuration for AgeCheck Study.
//
// Everything a participant reads, and everything the researcher can change
// before collection, lives here. The researcher dashboard edits a copy of
// this object and freezes it when research mode is activated. Condition
// wording, the scenario, and the questionnaire are part of the versioned
// configuration and must not change once collection has started.
//
// Text in [SQUARE BRACKETS] is a placeholder. Research mode cannot be
// activated while any placeholder remains.

import { FIELDS } from "./data-dictionary.js";

export const CONFIG_SCHEMA_VERSION = 1;

export const DEFAULT_STUDY_CONFIG = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  studyVersion: "1.0.0-draft",
  // "preview": synthetic and walkthrough records only, clearly marked.
  // "research": real collection, only after activation checks pass.
  mode: "preview",
  frozen: false,
  activatedOn: null,

  appName: "AgeCheck Study",
  platformName: "ConnectSpace",

  eligibility: {
    // Approved age range. Ages are collected as single-year categories,
    // never as a birth date.
    minAge: 16,
    maxAge: 17,
    recruitmentCriteriaText:
      "I was invited to take part through the approved Prosper-area recruitment process.",
    recruitmentCode: {
      enabled: false,
      label: "Recruitment code (only if you were given one)",
      help: "Codes never contain names or student IDs.",
      pattern: "^[A-Za-z0-9-]{3,16}$",
    },
    ineligibleMessage:
      "Thank you for your interest. This study is only open to participants who meet its approved eligibility requirements, so it ends here. Nothing you entered has been saved.",
  },

  intro: {
    heading: "About this study",
    body:
      "You will try a simulated age-verification process for a fictional online platform and answer questions about your experience. No camera, facial images, or government ID will be collected. When making choices, imagine how you would respond if the platform and its requests were real.",
    continueLabel: "Continue",
  },

  consent: {
    heading: "Study information and assent",
    researcherContact: "[RESEARCHER NAME, ROLE, AND CONTACT INFORMATION]",
    supervisorContact: "[SUPERVISOR OR TEACHER NAME AND CONTACT INFORMATION]",
    participationRequirements: "[APPROVED PARTICIPATION REQUIREMENTS]",
    dataCollected:
      "The research app records: a random response code, the study version, which of two information screens you were shown, your choices in the simulated process (start or decline, continue or stop), your questionnaire answers, and the time between steps. The app itself does not record your name, email address, birth date, home address, student ID, or any images. [HOSTING NOTE: STATE WHETHER THE HOSTING SERVICE LOGS IP ADDRESSES OR OTHER CONNECTION DETAILS]",
    storageAndAccess: "[DATA STORAGE, ACCESS, AND RETENTION ARRANGEMENTS]",
    withdrawal: "[WITHDRAWAL PROCEDURE, INCLUDING HOW TO USE THE RESPONSE CODE]",
    duration: "[EXPECTED DURATION]",
    parentalPermissionNote:
      "If you are under 18, parental permission is handled through the approved recruitment process outside this app. Nothing you check on this screen replaces that permission.",
    assentStatement: "I have read this information and agree to take part.",
    agreeLabel: "Continue",
    declineLabel: "I do not want to take part",
    declinedMessage:
      "Thank you for considering the study. You have not taken part, and nothing has been saved. You can close this window.",
  },

  scenario: {
    heading: "A fictional platform",
    body:
      "Imagine you want to join a group voice chat on ConnectSpace. This feature is available to users aged 16 and older. Before entering, the platform asks you to complete an age check.",
    continueLabel: "Continue",
  },

  verification: {
    heading: "Confirm your age group",
    body: "ConnectSpace uses a facial age check to assess whether you meet the age requirement for this feature.",
    // Shown only in the advance-notice condition. The later-notice condition
    // reserves the same space so the layout is identical.
    advanceNoticeSentence:
      "If the facial check cannot confidently confirm your age, you may be asked to provide a government-issued ID.",
    startLabel: "Start simulated check",
    declineLabel: "Decline verification",
    declinedMessage: "Your choice has been recorded.",
  },

  simulation: {
    label: "Simulated check",
    durationMs: 3000,
    status: "Checking",
  },

  result: {
    line1: "We could not confidently confirm that you meet the age requirement.",
    line2: "To continue to this feature, ConnectSpace would request a government-issued ID.",
    line3: "This is a simulation. Do not provide a real ID.",
    continueLabel: "I would continue with ID verification",
    stopLabel: "I would stop here",
    continueConfirmation: "Your choice has been recorded. No ID is needed for this study.",
    stopConfirmation: "Your choice has been recorded.",
    nextLabel: "Continue to the questions",
  },

  questionnaire: {
    heading: "Your experience",
    instruction: "Answer based on how you would feel if this were a real platform. You may skip any question.",
    scale: [
      { value: 1, label: "Strongly disagree" },
      { value: 2, label: "Disagree" },
      { value: 3, label: "Neither agree nor disagree" },
      { value: 4, label: "Agree" },
      { value: 5, label: "Strongly agree" },
    ],
    // Agreement items. "measure" is a label for the researcher only; the
    // measures are stored separately and never combined automatically.
    items: [
      {
        id: "risk_exposure",
        measure: "perceived_privacy_risk",
        text: "I would be concerned that information requested during this process could be exposed in a security incident.",
      },
      {
        id: "risk_misuse",
        measure: "perceived_privacy_risk",
        text: "I would be concerned that information requested during this process could be used for purposes I did not expect.",
      },
      {
        id: "risk_feel",
        measure: "perceived_privacy_risk",
        text: "Providing the information requested during this process would feel risky to me.",
      },
      {
        id: "transp_explained",
        measure: "perceived_transparency",
        text: "The platform clearly explained what the verification process could involve.",
      },
      {
        id: "transp_expect",
        measure: "perceived_transparency",
        text: "I knew what to expect from the process before deciding whether to start.",
      },
      {
        id: "id_unexpected",
        measure: "unexpectedness",
        onlyIfReachedIdPrompt: true,
        text: "The government-ID request was unexpected.",
      },
      {
        id: "id_understood",
        measure: "unexpectedness",
        onlyIfReachedIdPrompt: true,
        text: "Before starting the facial check, I understood that a government ID might be requested.",
      },
    ],
    recall: {
      id: "recall_notice",
      text: "Before the simulated facial check began, did the screen mention that a government ID might be requested?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
        { value: "did_not_start", label: "I did not start the check" },
      ],
    },
    priorExperience: {
      id: "prior_experience",
      text: "Have you previously encountered an online age-verification process?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
        { value: "prefer_not", label: "Prefer not to answer" },
      ],
    },
    idAvailability: {
      id: "id_availability",
      text: "Would you have access to an acceptable government-issued ID if a real platform requested one?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
        { value: "prefer_not", label: "Prefer not to answer" },
      ],
    },
    breachAwareness: {
      id: "breach_awareness",
      text: "Before this study, had you heard about a security incident involving identity documents submitted for online age-related checks?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
        { value: "prefer_not", label: "Prefer not to answer" },
      ],
    },
    openEnded: {
      id: "open_influence",
      text: "What most influenced your decision to continue or stop?",
      maxLength: 1000,
    },
    stopReasons: {
      id: "stop_reasons",
      text: "You declined or stopped. What were your reasons? Select all that apply.",
      options: [
        { value: "privacy_security", label: "Privacy or security concerns" },
        { value: "no_id_available", label: "I would not have an acceptable ID available" },
        { value: "too_much_effort", label: "The process required too much effort" },
        { value: "unexpected_request", label: "The additional request was unexpected" },
        { value: "feature_not_important", label: "The feature was not important enough to me" },
        { value: "other", label: "Another reason" },
        { value: "prefer_not", label: "Prefer not to answer" },
      ],
    },
    submitLabel: "Submit answers",
  },

  // Disabled by default. Enable only if approved and justified by the
  // research plan. Comparisons on these items in a scripted simulation are
  // not evidence of algorithmic bias.
  demographics: {
    enabled: false,
    items: [
      {
        id: "demo_gender",
        text: "How do you describe your gender? (optional)",
        options: [
          { value: "woman", label: "Woman or girl" },
          { value: "man", label: "Man or boy" },
          { value: "nonbinary", label: "Non-binary" },
          { value: "self_describe", label: "I describe myself another way" },
          { value: "prefer_not", label: "Prefer not to answer" },
        ],
      },
      {
        id: "demo_race",
        text: "How do you describe your race or ethnicity? (optional)",
        options: [
          { value: "asian", label: "Asian" },
          { value: "black", label: "Black or African American" },
          { value: "hispanic", label: "Hispanic or Latino" },
          { value: "middle_eastern", label: "Middle Eastern or North African" },
          { value: "native", label: "American Indian or Alaska Native" },
          { value: "pacific", label: "Native Hawaiian or Pacific Islander" },
          { value: "white", label: "White" },
          { value: "multiple", label: "Two or more" },
          { value: "self_describe", label: "I describe myself another way" },
          { value: "prefer_not", label: "Prefer not to answer" },
        ],
      },
    ],
  },

  debrief: {
    heading: "About this study",
    body:
      "This study examines whether receiving advance notice of a possible government-ID requirement affects responses to a simulated age-verification process. The facial check and its result were scripted. No camera, facial images, or government IDs were collected.",
    scope:
      "The study measures choices made within a disclosed simulation. It does not measure whether anyone would upload a real ID.",
    responseCodeIntro:
      "Your response code is below. Keep it if you might want your answers removed later. You can request deletion with this code alone; no name is needed.",
    finishLabel: "Finish",
    finishedMessage: "Thank you. You may close this window.",
  },

  withdrawal: {
    linkLabel: "Withdraw from study",
    heading: "Withdraw from the study?",
    body:
      "Withdrawing ends your participation now. It is different from declining the fictional platform's verification. Your answers so far will be handled as described in the study information.",
    confirmLabel: "Yes, withdraw",
    cancelLabel: "No, go back",
    // The researcher's retention policy for a mid-session withdrawal:
    //   false  only the fact of withdrawal, the condition, and the step reached are kept
    //   true   partial responses are kept, marked withdrawn
    //   null   not chosen yet. Research mode cannot be activated until it is.
    //          Preview mode behaves as false, the more protective choice.
    retainPartialResponses: null,
    withdrawnMessage:
      "You have withdrawn from the study. Thank you for your time. You may close this window.",
  },

  // Storage is set by the researcher before activation.
  //   none:            preview only; nothing is stored as research data
  //   local-device:    records stay in this browser's storage on this device
  //   remote-endpoint: records are sent to the reference server (server/)
  storage: {
    adapter: "none",
    endpointUrl: "",
    submitToken: "",
  },

  // Preview-only helpers. Ignored in research mode.
  preview: {
    allowForcedCondition: true,
  },
};

export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z0-9 ,.:;'()/-]*\]/g;

/**
 * Study information only the researcher can supply. Each entry must be filled
 * in, with no placeholder left, before research mode can be activated. The app
 * never supplies contacts, approvals, or a retention policy on its own.
 */
export const REQUIRED_STUDY_INFORMATION = [
  ["consent.researcherContact", "Researcher contact"],
  ["consent.supervisorContact", "Supervisor or teacher contact"],
  ["consent.participationRequirements", "Approved participation requirements"],
  ["consent.dataCollected", "What the research app records"],
  ["consent.storageAndAccess", "Data storage, access, and retention"],
  ["consent.withdrawal", "Withdrawal procedure"],
  ["consent.duration", "Expected duration"],
  ["consent.parentalPermissionNote", "Parental permission note"],
  ["consent.assentStatement", "Assent statement"],
  ["eligibility.recruitmentCriteriaText", "Recruitment criteria statement"],
];

function get(config, path) {
  let v = config;
  for (const key of path.split(".")) {
    if (v === null || typeof v !== "object") return undefined;
    v = v[key];
  }
  return v;
}

function isText(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/** Return every placeholder still present in researcher-editable text. */
export function findPlaceholders(config) {
  const found = [];
  const seen = new Set();
  const check = (field, value) => {
    if (typeof value !== "string" || seen.has(field)) return;
    seen.add(field);
    const matches = value.match(PLACEHOLDER_PATTERN);
    if (matches) found.push({ field, placeholders: matches });
  };
  const c = (config && config.consent) || {};
  for (const key of Object.keys(c)) check(`consent.${key}`, c[key]);
  for (const [path] of REQUIRED_STUDY_INFORMATION) check(path, get(config, path));
  return found;
}

/** Age categories derived from the approved range. */
export function ageCategories(config) {
  const { minAge, maxAge } = config.eligibility;
  const cats = [];
  cats.push({ value: `under_${minAge}`, label: `${minAge - 1} or younger`, eligible: false });
  for (let age = minAge; age <= maxAge; age += 1) {
    cats.push({ value: `age_${age}`, label: String(age), eligible: true });
  }
  cats.push({ value: `over_${maxAge}`, label: `${maxAge + 1} or older`, eligible: false });
  return cats;
}

/** Deep clone (structuredClone exists in browsers and Node 17+). */
export function cloneConfig(config) {
  return structuredClone(config);
}

/** Merge a stored (possibly partial) config over the defaults. */
export function mergeConfig(stored) {
  const base = cloneConfig(DEFAULT_STUDY_CONFIG);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  return deepMerge(base, stored);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const s = source[key];
    const t = target[key];
    if (Array.isArray(s)) {
      target[key] = structuredClone(s);
    } else if (s && typeof s === "object" && t && typeof t === "object" && !Array.isArray(t)) {
      deepMerge(t, s);
    } else {
      target[key] = s;
    }
  }
  return target;
}

/** true only when the researcher chose to keep partial responses after a withdrawal. */
export function retainsPartialResponses(config) {
  return Boolean(config && config.withdrawal && config.withdrawal.retainPartialResponses === true);
}

// ---------------------------------------------------------------------------
// Validation. Used wherever a configuration enters the app: the dashboard
// (saving, importing, activating), the participant app (a served
// study.config.json or the browser's saved copy), and the reference server.

const TEXT_FIELDS = [
  "appName", "platformName",
  "eligibility.ineligibleMessage",
  "intro.heading", "intro.body", "intro.continueLabel",
  "consent.heading", "consent.agreeLabel", "consent.declineLabel", "consent.declinedMessage",
  "scenario.heading", "scenario.body", "scenario.continueLabel",
  "verification.heading", "verification.body", "verification.advanceNoticeSentence",
  "verification.startLabel", "verification.declineLabel", "verification.declinedMessage",
  "simulation.label", "simulation.status",
  "result.line1", "result.line2", "result.line3", "result.continueLabel", "result.stopLabel",
  "result.continueConfirmation", "result.stopConfirmation", "result.nextLabel",
  "questionnaire.heading", "questionnaire.instruction", "questionnaire.submitLabel",
  "debrief.heading", "debrief.body", "debrief.scope", "debrief.responseCodeIntro",
  "debrief.finishLabel", "debrief.finishedMessage",
  "withdrawal.linkLabel", "withdrawal.heading", "withdrawal.body", "withdrawal.confirmLabel",
  "withdrawal.cancelLabel", "withdrawal.withdrawnMessage",
];

const STRING_FIELDS = [
  ...REQUIRED_STUDY_INFORMATION.map(([path]) => path),
  "storage.endpointUrl", "storage.submitToken",
  "eligibility.recruitmentCode.label", "eligibility.recruitmentCode.help", "eligibility.recruitmentCode.pattern",
];

const LIKERT_IDS = ["risk_exposure", "risk_misuse", "risk_feel", "transp_explained", "transp_expect", "id_unexpected", "id_understood"];
const ID_PROMPT_ONLY = ["id_unexpected", "id_understood"];
const CHOICE_BLOCKS = [
  ["recall", "recall_notice"],
  ["priorExperience", "prior_experience"],
  ["idAvailability", "id_availability"],
  ["breachAwareness", "breach_awareness"],
];
const DEMOGRAPHIC_IDS = ["demo_gender", "demo_race"];
const STORAGE_ADAPTERS = ["none", "local-device", "remote-endpoint"];

function dictionaryValues(itemId) {
  const field = FIELDS.find((f) => f.name === `q_${itemId}`);
  return field ? field.values : [];
}

function sameSet(a, b) {
  return a.length === b.length && new Set(a).size === a.length && a.every((v) => b.includes(v));
}

function checkOptions(problems, where, options, allowed, { exact }) {
  if (!Array.isArray(options) || options.length === 0) {
    problems.push(`${where} must list its answer choices.`);
    return;
  }
  const values = options.map((o) => (o && typeof o === "object" ? String(o.value) : ""));
  if (options.some((o) => !o || typeof o !== "object" || !isText(o.label))) problems.push(`${where}: every answer choice needs a label.`);
  const ok = exact ? sameSet(values, allowed) : new Set(values).size === values.length && values.every((v) => allowed.includes(v));
  if (!ok) problems.push(`${where}: the answer choices must be ${exact ? "exactly" : "among"} ${allowed.join(", ")} (the values in the data dictionary).`);
}

/**
 * Structural check: the shape, types, and fixed codes the app, the data
 * dictionary, and the server rely on. Returns a list of problems; an empty
 * list means the configuration can be loaded. It does not judge whether the
 * study information has been written yet (activationProblems does that).
 */
export function validateConfig(config) {
  const problems = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return ["The configuration is not an object."];

  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) problems.push(`schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  if (config.mode !== "preview" && config.mode !== "research") problems.push('mode must be "preview" or "research".');
  if (typeof config.frozen !== "boolean") problems.push("frozen must be true or false.");
  if (!(config.activatedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(String(config.activatedOn)))) problems.push("activatedOn must be empty or a date (YYYY-MM-DD).");
  if (typeof config.studyVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(config.studyVersion)) {
    problems.push("Study version must be 1 to 40 letters, digits, dots, dashes, or underscores, starting with a letter or digit.");
  }

  for (const path of TEXT_FIELDS) if (!isText(get(config, path))) problems.push(`${path} must be non-empty text.`);
  for (const path of STRING_FIELDS) if (typeof get(config, path) !== "string") problems.push(`${path} must be text.`);

  const e = config.eligibility || {};
  if (!Number.isInteger(e.minAge) || !Number.isInteger(e.maxAge) || e.minAge > e.maxAge || e.minAge < 13 || e.maxAge > 25) {
    problems.push("Approved age range must be whole numbers between 13 and 25 with the minimum no greater than the maximum.");
  }
  const rc = e.recruitmentCode || {};
  if (typeof rc.enabled !== "boolean") problems.push("eligibility.recruitmentCode.enabled must be true or false.");
  if (typeof rc.pattern === "string") {
    try {
      new RegExp(rc.pattern);
    } catch {
      problems.push("eligibility.recruitmentCode.pattern is not a valid pattern.");
    }
  }

  const sim = config.simulation || {};
  if (!Number.isInteger(sim.durationMs) || sim.durationMs < 2500 || sim.durationMs > 3500) {
    problems.push("simulation.durationMs must stay close to three seconds (2500 to 3500).");
  }

  const q = config.questionnaire || {};
  const scale = Array.isArray(q.scale) ? q.scale : [];
  if (scale.length !== 5 || scale.some((s, i) => !s || s.value !== i + 1 || !isText(s.label))) {
    problems.push("questionnaire.scale must be the five agreement points 1 to 5, each with a label.");
  }
  const items = Array.isArray(q.items) ? q.items : [];
  const itemIds = items.map((it) => (it && typeof it === "object" ? it.id : undefined));
  if (!sameSet(itemIds, LIKERT_IDS)) problems.push(`questionnaire.items must be exactly these items, once each: ${LIKERT_IDS.join(", ")}.`);
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (!isText(it.text)) problems.push(`questionnaire item ${it.id}: the wording is missing.`);
    const idOnly = ID_PROMPT_ONLY.includes(it.id);
    if (Boolean(it.onlyIfReachedIdPrompt) !== idOnly) problems.push(`questionnaire item ${it.id}: onlyIfReachedIdPrompt must be ${idOnly}.`);
  }
  for (const [key, id] of CHOICE_BLOCKS) {
    const block = q[key];
    if (!block || typeof block !== "object" || block.id !== id || !isText(block.text)) {
      problems.push(`questionnaire.${key} must have id "${id}" and its wording.`);
      continue;
    }
    checkOptions(problems, `questionnaire.${key}`, block.options, dictionaryValues(id), { exact: true });
  }
  const open = q.openEnded;
  if (!open || open.id !== "open_influence" || !isText(open.text) || !Number.isInteger(open.maxLength) || open.maxLength < 1 || open.maxLength > 1000) {
    problems.push('questionnaire.openEnded must have id "open_influence", its wording, and a maxLength from 1 to 1000.');
  }
  const stop = q.stopReasons;
  if (!stop || stop.id !== "stop_reasons" || !isText(stop.text)) problems.push('questionnaire.stopReasons must have id "stop_reasons" and its wording.');
  else checkOptions(problems, "questionnaire.stopReasons", stop.options, dictionaryValues("stop_reasons"), { exact: true });

  const d = config.demographics || {};
  if (typeof d.enabled !== "boolean") problems.push("demographics.enabled must be true or false.");
  const dItems = Array.isArray(d.items) ? d.items : null;
  if (!dItems) problems.push("demographics.items must be a list.");
  else {
    const ids = dItems.map((it) => (it && typeof it === "object" ? it.id : undefined));
    if (new Set(ids).size !== ids.length || ids.some((id) => !DEMOGRAPHIC_IDS.includes(id))) {
      problems.push(`demographics.items may only contain ${DEMOGRAPHIC_IDS.join(" and ")}, once each.`);
    }
    for (const it of dItems) {
      if (!it || typeof it !== "object" || !DEMOGRAPHIC_IDS.includes(it.id)) continue;
      if (!isText(it.text)) problems.push(`demographics item ${it.id}: the wording is missing.`);
      checkOptions(problems, `demographics item ${it.id}`, it.options, dictionaryValues(it.id), { exact: false });
    }
  }

  const w = config.withdrawal || {};
  if (!(w.retainPartialResponses === null || typeof w.retainPartialResponses === "boolean")) {
    problems.push("withdrawal.retainPartialResponses must be true, false, or not yet chosen.");
  }

  const s = config.storage || {};
  if (!STORAGE_ADAPTERS.includes(s.adapter)) problems.push(`storage.adapter must be one of ${STORAGE_ADAPTERS.join(", ")}.`);

  const p = config.preview || {};
  if (typeof p.allowForcedCondition !== "boolean") problems.push("preview.allowForcedCondition must be true or false.");

  return problems;
}

/**
 * Everything that must be true before research mode may be activated, or
 * before a research-mode configuration may be used anywhere. Returns a list
 * of problems; an empty list means collection may run.
 */
export function activationProblems(config) {
  const problems = validateConfig(config);
  if (!config || typeof config !== "object") return problems;

  const placeholders = new Map(findPlaceholders(config).map((p) => [p.field, p.placeholders]));
  for (const [path, label] of REQUIRED_STUDY_INFORMATION) {
    const value = get(config, path);
    if (!isText(value)) problems.push(`${label} is required and is empty (${path}).`);
    else if (placeholders.has(path)) problems.push(`${label} still contains placeholder text: ${placeholders.get(path).join(", ")} (${path}).`);
    placeholders.delete(path);
  }
  for (const [field, found] of placeholders) problems.push(`Placeholder text remains in ${field}: ${found.join(", ")}`);

  const s = config.storage || {};
  if (s.adapter === "none" || !s.adapter) {
    problems.push("A storage configuration is required (local-device or remote-endpoint).");
  } else if (s.adapter === "remote-endpoint") {
    if (!/^https?:\/\/[^\s/]+/.test(s.endpointUrl || "")) problems.push("Remote endpoint URL must start with http:// or https://.");
    if (!s.submitToken || s.submitToken.length < 16) problems.push("Remote endpoint submit token must be at least 16 characters.");
  }

  if (typeof config.studyVersion === "string" && /draft/i.test(config.studyVersion)) {
    problems.push('Study version must be set to a non-draft value (for example "1.0.0").');
  }
  const w = config.withdrawal || {};
  if (typeof w.retainPartialResponses !== "boolean") {
    problems.push("Withdrawal policy must be chosen: keep partial responses after a withdrawal, or withhold them.");
  }
  return problems;
}

/** The checks that apply to a configuration in its own mode. */
export function configProblems(config) {
  return config && config.mode === "research" ? activationProblems(config) : validateConfig(config);
}

/**
 * Reads a configuration that came from outside (an import, a served
 * study.config.json, the browser's saved copy, a server upload). Returns
 * { config, problems }. The configuration must not be used while problems
 * is not empty.
 */
export function parseConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { config: null, problems: ["The configuration is not an object."] };
  }
  if (input.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return { config: null, problems: [`This is not a study configuration for schema version ${CONFIG_SCHEMA_VERSION}.`] };
  }
  const config = mergeConfig(input);
  return { config, problems: configProblems(config) };
}
