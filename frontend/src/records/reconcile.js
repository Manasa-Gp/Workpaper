// records/reconcile.js — Cal1 (figures that should agree) and Cal4 (income split between states).

import { context, link } from './core.js';
import { crossFor, incomeFor } from '../serverchecks.js';

const WORD = { pass: 'Agree', fail: 'Do not agree' };
const days = (from, to) => Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1;

export function reconciliations(state) {
  const list = crossFor(state).filter((c) => c.group === 'reconcile');
  const bad = list.filter((c) => c.status === 'fail').length;
  return {
    intro: `Figures that should be the same in two places. ${bad} of ${list.length} do not agree. Each row is also a check on the lines it is about.`,
    tables: [{
      heading: 'Pairs that should agree',
      columns: [{ label: 'Check' }, { label: 'Result' }, { label: 'First figure', num: true }, { label: 'Second figure', num: true }, { label: 'Line' }, { label: 'What it means' }],
      rows: list.map((c) => [c.label, WORD[c.status], c.said, c.other, c.lines[0] ? link(c.lines[0]) : null, c.detail]),
    }],
  };
}

export function incomeSplit(state) {
  const ctx = context(state);
  const rows = incomeFor(state);
  const periods = ctx.packet.household.residency ?? [];
  const move = periods.find((p) => p.state !== 'CA');
  const sum = (col) => Math.round(rows.reduce((n, r) => n + r[col], 0) * 100) / 100;
  const checks = crossFor(state).filter((c) => c.group === 'state');
  const outside = rows.reduce((n, r) => n + r.outside, 0);
  return {
    intro: `The household moved from California to ${move?.state ?? 'another state'}${move ? ` on ${move.from}` : ''}. California taxes what was earned while living there and California-source income afterwards. The rest is outside California${move ? ` (${move.state} has no state income tax)` : ''}. Each column below must add up to the total on the form.`,
    tables: [
      {
        heading: 'Where the household lived',
        columns: [{ label: 'State' }, { label: 'From' }, { label: 'To' }, { label: 'Days', num: true }, { label: 'Status' }],
        rows: periods.map((p) => [p.state, p.from, p.to, days(p.from, p.to), p.status]),
      },
      {
        heading: 'Income by category and state',
        columns: [{ label: 'Category' }, { label: 'Federal', num: true }, { label: 'Using California law', num: true }, { label: 'California', num: true }, { label: `Outside California${move ? ` (${move.state})` : ''}`, num: true }],
        rows: [
          ...rows.map((r) => [link(r.keys.A), r.A, r.D, r.E, r.outside]),
          ['Total', sum('A'), sum('D'), sum('E'), Math.round(outside * 100) / 100],
        ],
        note: 'California law differs from federal law for some items (for example bonus depreciation), so the second column is not always the federal figure.',
      },
      {
        heading: 'Do the states add up?',
        columns: [{ label: 'Check' }, { label: 'Result' }, { label: 'Categories add to', num: true }, { label: 'Form says', num: true }, { label: 'Line' }, { label: 'What it means' }],
        rows: checks.map((c) => [c.label, WORD[c.status], c.said, c.other, link(c.lines[0]), c.detail]),
      },
    ],
  };
}
