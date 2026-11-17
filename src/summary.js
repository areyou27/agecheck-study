// Counts, completion rates, and filters for the researcher dashboard.
// Pure functions over records, so the arithmetic can be tested on its own.

import { CONDITIONS } from "./data-dictionary.js";

export const EMPTY_FILTERS = { condition: "", pathway: "", status: "", version: "" };

/** Records matching every filter that is set. An empty filter matches everything. */
export function filterRecords(records, filters = EMPTY_FILTERS) {
  const f = { ...EMPTY_FILTERS, ...filters };
  return records.filter(
    (r) =>
      (!f.condition || r.condition === f.condition) &&
      (!f.pathway || r.final_pathway === f.pathway) &&
      (!f.status || r.submission_status === f.status) &&
      (!f.version || r.study_version === f.version)
  );
}

export function hasActiveFilters(filters = EMPTY_FILTERS) {
  return Object.keys(EMPTY_FILTERS).some((k) => Boolean(filters[k]));
}

/** Study versions present in the records, sorted. */
export function studyVersions(records) {
  return [...new Set(records.map((r) => r.study_version))].sort();
}

/** A proportion with its parts kept, so an empty group is never shown as 0% or NaN. */
export function rate(numerator, denominator) {
  return { numerator, denominator, percent: denominator > 0 ? (100 * numerator) / denominator : null };
}

export function formatRate(r) {
  if (!r || r.denominator === 0) return "no records";
  return `${r.numerator} / ${r.denominator} (${r.percent.toFixed(1)}%)`;
}

/**
 * Counts and rates for one group of records (normally one condition).
 *
 * "Eligible" records are those not withdrawn. Every decision count, every
 * numerator, and the missing-questionnaire count come from eligible records
 * only, whatever the withdrawal policy left on a withdrawn record, so the
 * dashboard reads the same under either policy. So a rate that excludes withdrawn participants
 * excludes them from the numerator and the denominator alike, and a rate over
 * everyone assigned counts a withdrawn participant in the denominator and
 * never as having continued.
 */
export function summarizeGroup(records) {
  const eligible = records.filter((r) => r.final_pathway !== "withdrawn");
  const count = (list, test) => list.filter(test).length;
  const assigned = records.length;
  const withdrawn = assigned - eligible.length;
  const declined = count(eligible, (r) => r.final_pathway === "declined_before_check");
  const started = count(eligible, (r) => r.initial_decision === "start");
  const reachedId = count(eligible, (r) => r.reached_id_prompt === "yes");
  const stopped = count(eligible, (r) => r.final_pathway === "stopped_at_id_request");
  const continued = count(eligible, (r) => r.final_pathway === "would_continue_with_id");
  const incomplete = count(eligible, (r) => r.final_pathway === "incomplete_session");
  const questionnaireMissing = count(eligible, (r) => r.questionnaire_status !== "submitted");
  return {
    assigned,
    withdrawn,
    eligible: eligible.length,
    declined,
    started,
    reachedId,
    stopped,
    continued,
    incomplete,
    questionnaireMissing,
    rates: {
      continuedAmongAssigned: rate(continued, assigned),
      continuedExcludingWithdrawn: rate(continued, eligible.length),
      startedExcludingWithdrawn: rate(started, eligible.length),
      continuedAmongReached: rate(continued, reachedId),
    },
  };
}

/** One summary per condition, plus one for all the records together. */
export function summarize(records) {
  const byCondition = {};
  for (const condition of CONDITIONS) {
    byCondition[condition] = summarizeGroup(records.filter((r) => r.condition === condition));
  }
  return { byCondition, all: summarizeGroup(records) };
}
