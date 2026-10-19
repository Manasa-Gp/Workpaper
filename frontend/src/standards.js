// standards.js — the firm's written standards (from the packet), and which lines break the ones a screen can test.
//
// Called by: views/standards.js (the Firm standards panel) and views/statuscounts.js (the counts bar).
// Reads:     packet.firm.starter_standards, trace.js (last year's value), events.js. Nothing here is saved.
//
// Two rules are tested here because the packet has everything they need:
//   variance_review   a number moved more than 10% AND more than 1,000 against last year
//   self-review       the same person adjusted a number and signed it off ("a person may not review their own work")
// The other rules are shown as text; the server already enforces some of them (rules.py).

import { effectiveValue, openQuestionCount, allOpenReviewPoints, signoffState } from './events.js';
import { lastYear } from './trace.js';

export const standardsOf = (packet) => packet.firm.starter_standards;

/** Lines whose change against last year breaks the firm's variance rule, biggest change first. */
export function varianceFlags(index, events) {
  const rule = standardsOf(index.packet).variance_review;
  const out = [];
  for (const line of index.current.lines) {
    if (typeof line.value !== 'number') continue;
    const last = lastYear(index, line.key);
    if (!last || typeof last.value !== 'number') continue;
    const now = effectiveValue(line, events);
    if (typeof now !== 'number') continue;
    const change = now - last.value;
    const pct = last.value === 0 ? null : (Math.abs(change) / Math.abs(last.value)) * 100; // null = from zero
    if (Math.abs(change) > rule.and_over_amount && (pct === null || pct > rule.flag_if_change_over_percent)) {
      out.push({ key: line.key, label: line.label, now, last: last.value, change, pct });
    }
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/** Sign-offs by someone who also adjusted (or amended) the same number. One row per line and person. */
export function selfReviews(events) {
  const seen = new Set();
  const out = [];
  for (const s of events.filter((e) => e.type === 'signoff' && e.by?.name)) {
    const same = events.some((e) => e.claim === s.claim && (e.type === 'adjust' || e.type === 'amend') && e.by?.name === s.by.name);
    const id = `${s.claim}|${s.by.name}`;
    if (same && !seen.has(id)) { seen.add(id); out.push({ key: s.claim, name: s.by.name }); }
  }
  return out;
}

/** The numbers for the counts bar: how many lines in each state, signed off, and still open. */
export function statusCounts(state) {
  const lines = state.index.current.lines.filter((l) => l.value !== null && l.value !== undefined);
  const c = { pass: 0, warn: 0, fail: 0, na: 0 };
  let signed = 0;
  for (const l of lines) {
    c[state.statusByKey.get(l.key) ?? 'na'] += 1;
    if (signoffState(l, state.events).state === 'signed') signed += 1;
  }
  return {
    total: lines.length, ...c, signed,
    questions: lines.reduce((n, l) => n + openQuestionCount(state.events, l.key), 0),
    points: allOpenReviewPoints(state.events).length,
  };
}
