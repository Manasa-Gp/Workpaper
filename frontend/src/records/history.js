// records/history.js — R5: state split, carryovers, basis by year, and what the prior preparer did against what we changed.

import { carryforward } from '../carryforward.js';
import { context, diff, lineByKey, lineTable, link, nice, valueOf } from './core.js';

const days = (from, to) => Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1;

export function stateSplit(state) {
  const ctx = context(state);
  const periods = ctx.packet.household.residency ?? [];
  const fedAgi = lineByKey(ctx, 'F1040.11');
  const caFed = lineByKey(ctx, 'F540NR.13');
  return {
    intro: 'The household moved from California to Texas during the year, so California taxes only what it is allowed to. This shows the split and how the two returns connect.',
    tables: [
      {
        heading: 'Where the household lived',
        columns: [{ label: 'State' }, { label: 'From' }, { label: 'To' }, { label: 'Days', num: true }, { label: 'Status' }],
        rows: periods.map((p) => [p.state, p.from, p.to, days(p.from, p.to), p.status]),
      },
      {
        heading: 'The two returns agree on the starting point',
        columns: [{ label: 'Check' }, { label: 'Amount', num: true }],
        rows: [
          [fedAgi ? link('F1040.11') : 'Federal AGI', fedAgi ? valueOf(ctx, fedAgi) : null],
          [caFed ? link('F540NR.13') : 'Federal AGI on the California form', caFed ? valueOf(ctx, caFed) : null],
          ['Difference', fedAgi && caFed ? diff(valueOf(ctx, caFed), valueOf(ctx, fedAgi)) : null],
        ],
      },
      lineTable(ctx, 'California return (540NR)', (l) => l.form === 'F540NR', { rule: true }),
      lineTable(ctx, 'California adjustments (Schedule CA 540NR)', (l) => l.form === 'SchCA540NR', {}),
      lineTable(ctx, 'California underpayment penalty (FTB 5805)', (l) => l.form === 'FTB5805', {}),
    ],
  };
}

export function carryovers(state) {
  const ctx = context(state);
  const c = carryforward(ctx.packet);
  const rows = (list) => list.map((r) => [r.name, r.came, r.goes, r.came === null ? null : diff(r.goes, r.came)]);
  const columns = [{ label: 'Item' }, { label: 'Came in from last year', num: true }, { label: 'Goes out to next year', num: true }, { label: 'Change', num: true }];
  return {
    intro: 'Losses, credits and basis that carry from year to year. A figure that falls to zero was used up this year.',
    tables: [
      { heading: 'Federal', columns, rows: rows(c.federal) },
      { heading: 'California', columns, rows: rows(c.california) },
    ],
  };
}

export function basisByYear(state) {
  const ctx = context(state);
  const records = ctx.packet.prior_years.basis_records ?? {};
  const tables = Object.entries(records).map(([name, list]) => ({
    heading: nice(name),
    columns: [{ label: 'Year or event' }, { label: 'Figures' }, { label: 'Where it came from' }],
    rows: list.map((r) => [
      r.year ?? r.event,
      Object.entries(r).filter(([k, v]) => !['year', 'event', 'source'].includes(k) && v !== null).map(([k, v]) => `${nice(k)} ${typeof v === 'number' ? v.toLocaleString('en-US') : v}`).join(' · ') || 'No figures recorded',
      r.source ?? null,
    ]),
  }));
  tables.push(lineTable(ctx, '2025 on this return: S corporation stock basis', (l) => l.form === 'F7203', {}));
  tables.push(lineTable(ctx, '2025 on this return: IRA basis', ['F8606.2', 'F8606.13', 'F8606.14'], {}));
  return {
    intro: 'Basis year by year, from the prior preparer\'s file, then where this return leaves it. A blank figure means the prior file never worked it out.',
    tables,
  };
}

export function priorPreparer(state) {
  const ctx = context(state);
  const prior = ctx.packet.prior_years.return_2024 ?? {};
  const work = ctx.packet.prior_years.prior_preparer_workpaper ?? {};
  const changes = ctx.rv.changes_from_previous ?? [];
  return {
    intro: 'What the prior preparer left behind, and what we changed after taking over.',
    tables: [
      {
        heading: 'Last year\'s return',
        columns: [{ label: 'Detail' }, { label: 'Value' }],
        rows: [['Prepared by', prior.prepared_by ?? null], ['Filed', prior.filed ?? null], ['Residency', prior.residency ?? null], ['Prior preparer\'s summary', work.summary_memo ?? null]],
      },
      { heading: 'Prior preparer\'s notes', columns: [{ label: 'Note' }], rows: (work.notes ?? []).map((n) => [n]) },
      { heading: 'Left open by the prior preparer', columns: [{ label: 'Open item' }], rows: (work.open_items_left_by_prior_preparer ?? []).map((n) => [n]) },
      {
        heading: 'What we changed: each version of the return',
        columns: [{ label: 'Version' }, { label: 'Computed' }, { label: 'Why it was recomputed' }],
        rows: ctx.packet.return_versions.map((v) => [v.version, String(v.computed_at).slice(0, 10), v.trigger]),
      },
      {
        heading: `Lines that changed in ${ctx.rv.version}`,
        columns: [{ label: 'Line' }, { label: 'Change' }, { label: 'Was', num: true }, { label: 'Now', num: true }],
        rows: changes.slice(0, 60).map((c) => [link(c.key), c.change, c.old ?? null, c.new ?? null]),
        note: changes.length > 60 ? `Showing the first 60 of ${changes.length}.` : undefined,
      },
    ],
  };
}
