// records/income.js — R4: books to tax, rentals and passive losses, K-1 lines, retirement and foreign items, deductions and credits.

import { context, diff, lineByKey, lineTable, link, nice, valueOf } from './core.js';

export function booksToTax(state) {
  const ctx = context(state);
  return {
    intro: 'The studio\'s books turned into Schedule C. Lines marked with a note show where the tax figure differs from the books, and why.',
    tables: [
      lineTable(ctx, 'Schedule C, line by line', (l) => l.form === 'SchC', { prior: true, rule: true }),
      lineTable(ctx, 'Where tax differs from the books', (l) => ['SchC', 'F4562-C', 'F4562-E', 'SchSE', 'Sch1'].includes(l.form) && /book/i.test(l.note ?? ''), { note: true }),
      lineTable(ctx, 'Self-employment tax (Schedule SE)', (l) => l.form === 'SchSE', {}),
    ],
  };
}

export function rentals(state) {
  const ctx = context(state);
  const into = ctx.packet.prior_years.carryovers_into_2025 ?? {};
  const passive = Object.entries(into).filter(([k, v]) => k.startsWith('passive_') && typeof v === 'number').map(([k, v]) => [nice(k.replace('passive_', 'Suspended loss: ')), v]);
  return {
    intro: 'Both rental properties, then the passive loss rules that decide how much of the losses can be used.',
    tables: [
      lineTable(ctx, 'Rental income and expenses (Schedule E)', (l) => l.form === 'SchE', { note: true }),
      lineTable(ctx, 'Passive activity losses (Form 8582)', (l) => l.form === 'F8582', { note: true }),
      { heading: 'Passive losses brought in from last year', columns: [{ label: 'Property' }, { label: 'Amount', num: true }], rows: passive },
    ],
  };
}

export function k1Lines(state) {
  const ctx = context(state);
  const prior = ctx.packet.prior_years.return_2024 ?? {};
  const priorRows = [];
  if (prior.K1_1120S) priorRows.push(['S corporation K-1 (2024)', 'Box 1 income', prior.K1_1120S.box1], ['S corporation K-1 (2024)', 'Box 16D distributions', prior.K1_1120S.box16D]);
  if (prior.K1_1065) priorRows.push([`${prior.K1_1065.partnership} (2024)`, 'Box 2', prior.K1_1065.box2], [`${prior.K1_1065.partnership} (2024)`, 'Ending capital', prior.K1_1065.ending_capital]);
  const k1Docs = ctx.packet.documents.filter((d) => /K-1/i.test(d.document_type));
  return {
    intro: 'The S corporation and the partnership: the basis calculation, the business income deduction, and the K-1 documents behind them.',
    tables: [
      lineTable(ctx, 'S corporation stock basis (Form 7203)', (l) => l.form === 'F7203', { note: true }),
      lineTable(ctx, 'Qualified business income (Form 8995)', (l) => l.form === 'F8995', {}),
      { heading: 'K-1 documents', columns: [{ label: 'ID' }, { label: 'Title' }, { label: 'Type' }, { label: 'Issuer' }], rows: k1Docs.map((d) => [d.id, d.title, d.document_type, d.issuer ?? null]) },
      { heading: 'Last year\'s K-1 figures', columns: [{ label: 'Source' }, { label: 'What' }, { label: 'Amount', num: true }], rows: priorRows },
    ],
  };
}

export function retirementForeign(state) {
  const ctx = context(state);
  return {
    intro: 'The IRA conversion, the health savings account, and the foreign bank account and tax credit.',
    tables: [
      lineTable(ctx, 'IRA basis and conversion (Form 8606)', (l) => l.form === 'F8606', { prior: true }),
      lineTable(ctx, 'Health savings account (Form 8889)', (l) => l.form === 'F8889', {}),
      lineTable(ctx, 'Foreign accounts (Form 8938)', (l) => l.form === 'F8938', {}),
      lineTable(ctx, 'Foreign tax credit and IRA income on the return', ['Sch3.1', 'F6251.8', 'F1040.4a', 'F1040.4b'], {}),
    ],
  };
}

// Pairs of lines: the figure before a limit and the figure after it.
const LIMITS = [
  ['State and local taxes', 'SchA.5d', 'SchA.5e'],
  ['Child and other dependent credit (before and after phase-out)', 'F8812.8', 'F8812.12'],
  ['Business income deduction (before and after the income limit)', 'F8995.27', 'F8995.39'],
  ['Alternative minimum tax: income it starts from, then the tax after the foreign credit', 'F6251.4', 'F6251.9'],
];

export function deductionsCredits(state) {
  const ctx = context(state);
  const limits = LIMITS.map(([name, before, after]) => {
    const a = lineByKey(ctx, before); const b = lineByKey(ctx, after);
    return a && b ? [name, link(before), valueOf(ctx, a), link(after), valueOf(ctx, b), diff(valueOf(ctx, b), valueOf(ctx, a))] : null;
  }).filter(Boolean);
  return {
    intro: 'Itemized deductions and credits, with the limits that cut them down.',
    tables: [
      { heading: 'Limits at work', columns: [{ label: 'Limit' }, { label: 'Before' }, { label: 'Amount', num: true }, { label: 'After' }, { label: 'Amount', num: true }, { label: 'Change', num: true }], rows: limits },
      lineTable(ctx, 'Itemized deductions (Schedule A)', (l) => l.form === 'SchA', { prior: true, note: true }),
      lineTable(ctx, 'Gifts other than cash (Form 8283)', (l) => l.form === 'F8283', {}),
      lineTable(ctx, 'Child and other dependent credit (Form 8812)', (l) => l.form === 'F8812', { note: true }),
      lineTable(ctx, 'Child and dependent care (Form 2441)', (l) => l.form === 'F2441', { note: true }),
      lineTable(ctx, 'Education credit (Form 8863)', (l) => l.form === 'F8863', { note: true }),
    ],
  };
}
