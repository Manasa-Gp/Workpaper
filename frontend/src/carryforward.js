// carryforward.js — what rolls into next year, with its history, and what to plan and ask.
//
// Called by: views/nextyear.js (the Next year panel).
// Reads:     the packet only (return_versions, prior_years, planning_reference_2026, timeline). Nothing is saved.
//
// "Came in" is what last year's return handed to 2025; "Goes out" is what this return hands to 2026.
// A number that came in and is gone (used up) shows as a drop to 0, which is the history of that carryover.

const nice = (key) => String(key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const isNum = (v) => typeof v === 'number';

/** Rows { name, came, goes } for one jurisdiction. Nested groups (depreciation by asset) become one row each. */
function rows(out = {}, came = {}) {
  const result = [];
  for (const key of new Set([...Object.keys(out), ...Object.keys(came)])) {
    if (typeof out[key] === 'object' && out[key] !== null) {
      for (const [sub, v] of Object.entries(out[key])) result.push({ name: `${nice(key)} · ${sub}`, came: null, goes: v });
      continue;
    }
    if (!isNum(out[key]) && !isNum(came[key])) continue; // notes and other text
    const row = { name: nice(key), came: isNum(came[key]) ? came[key] : null, goes: isNum(out[key]) ? out[key] : 0 };
    if (!row.came && !row.goes) continue; // nothing to carry either way
    result.push(row);
  }
  return result;
}

export function carryforward(packet) {
  const versions = packet.return_versions;
  const out = versions[versions.length - 1].carryovers_out ?? {};
  const came = packet.prior_years.carryovers_into_2025 ?? {};
  const plan = packet.planning_reference_2026 ?? {};
  const start = packet.timeline.find((e) => e.event === 'next_year_engagement_started');
  return {
    federal: rows(out.federal, came),
    california: rows(out.california, came.california),
    opensFrom: start?.at ?? null,
    leftOpen: packet.prior_years.prior_preparer_workpaper?.open_items_left_by_prior_preparer ?? [],
    askClient: plan.known_2026_changes_for_this_household ?? [],
    federalDue: plan.federal_estimate_due_dates ?? [],
    californiaDue: plan.california_estimate_due_dates ?? [],
    safeHarbor: plan.federal_safe_harbor ?? null,
  };
}
