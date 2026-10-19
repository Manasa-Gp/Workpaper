// standards.js — the firm's written standards (from the packet), and which lines break the ones a screen can test.
//
// Called by: views/standards.js (the Firm standards panel) and views/statuscounts.js (the counts bar).
// Reads:     packet.firm.starter_standards, events.js. Nothing here is saved.
//
// The rules themselves (variance against last year, reviewing your own work) are worked out and enforced
// by the server (checks.py, rules.py). This file only reads the firm's written standards and counts lines.

import { openQuestionCount, allOpenReviewPoints } from './events.js';
import { signoffFor } from './serverchecks.js';

export const standardsOf = (packet) => packet.firm.starter_standards;

/** The numbers for the counts bar: how many lines in each state, signed off, and still open. */
export function statusCounts(state) {
  const lines = state.index.current.lines.filter((l) => l.value !== null && l.value !== undefined);
  const c = { pass: 0, warn: 0, fail: 0, na: 0 };
  let signed = 0;
  for (const l of lines) {
    c[state.statusByKey.get(l.key) ?? 'na'] += 1;
    if (signoffFor(state, l.key).state === 'signed') signed += 1;
  }
  return {
    total: lines.length, ...c, signed,
    questions: lines.reduce((n, l) => n + openQuestionCount(state.events, l.key), 0),
    points: allOpenReviewPoints(state.events).length,
  };
}
