// records/assets.js — R3: depreciation by asset, federal vs California vs AMT, and sales detail.

import { context, diff, lineTable, link, ofForm, sum, valueOf } from './core.js';

const disposed = (a) => (a.disposed ? (typeof a.disposed === 'string' ? a.disposed : 'Yes') : null);

export function depreciation(state) {
  const ctx = context(state);
  const assets = ctx.rv.assets ?? [];
  const f = (a, k) => a.federal?.[k] ?? null;
  return {
    intro: 'Every depreciable asset: what it cost, how it is written off, and what was claimed this year on the federal return.',
    tables: [
      {
        heading: 'Federal depreciation by asset',
        columns: [{ label: 'Asset' }, { label: 'Description' }, { label: 'Cost', num: true }, { label: 'In service' }, { label: 'Method' }, { label: 'Life (years)', num: true }, { label: 'Before 2025', num: true }, { label: '2025', num: true }, { label: 'Total to date', num: true }, { label: 'Sold' }],
        rows: assets.map((a) => [a.asset_id, a.description, a.cost, a.placed_in_service, a.method, a.life_years, f(a, 'prior_accumulated'), f(a, 'depreciation_2025'), f(a, 'accumulated_end'), disposed(a)]),
        note: 'Land is not depreciated. Buildings show the cost of the building and land together; the land part is left out of the write-off.',
      },
      lineTable(ctx, 'Depreciation forms', (l) => l.form === 'F4562-C' || l.form === 'F4562-E', { rule: true }),
    ],
  };
}

export function fedCaAmt(state) {
  const ctx = context(state);
  const assets = ctx.rv.assets ?? [];
  const rows = assets.map((a) => {
    const fed = a.federal?.depreciation_2025 ?? 0;
    const ca = a.california?.depreciation_2025 ?? 0;
    const amt = a.amt?.depreciation_2025 ?? 0;
    return [a.asset_id, a.description, fed, ca, diff(ca, fed), amt, a.amt?.difference_from_regular ?? 0];
  });
  const total = ['Total', '', sum(rows.map((r) => r[2])), sum(rows.map((r) => r[3])), sum(rows.map((r) => r[4])), sum(rows.map((r) => r[5])), sum(rows.map((r) => r[6]))];
  return {
    intro: 'The same assets written off three ways. California did not allow the federal 100% special depreciation, so its figures are smaller; AMT can differ again.',
    tables: [
      {
        heading: '2025 depreciation: federal, California and AMT',
        columns: [{ label: 'Asset' }, { label: 'Description' }, { label: 'Federal', num: true }, { label: 'California', num: true }, { label: 'California minus federal', num: true }, { label: 'AMT', num: true }, { label: 'AMT minus regular', num: true }],
        rows: [...rows, total],
      },
      lineTable(ctx, 'California depreciation differences (FTB 3885A)', (l) => l.form === 'FTB3885A', {}),
    ],
  };
}

const BOX = { A: 'Short-term, basis reported to the IRS', B: 'Short-term, basis not reported', D: 'Long-term, basis reported to the IRS', E: 'Long-term, basis not reported', F: 'Long-term, no 1099-B', H: 'Digital assets, short-term', K: 'Digital assets, long-term' };

export function salesDetail(state) {
  const ctx = context(state);
  const forms = ofForm(ctx, 'F8949');
  const boxOf = (l) => l.key.split('.')[1];
  const lots = forms.filter((l) => l.rule === 'R-8949-LOT' && typeof valueOf(ctx, l) === 'number');
  const totals = forms.filter((l) => l.rule === 'R-SUM');
  const boxes = [...new Set(forms.map(boxOf))].sort();
  const rows = boxes.map((b) => {
    const mine = lots.filter((l) => boxOf(l) === b);
    const gain = sum(mine.map((l) => valueOf(ctx, l)));
    const reported = sum(totals.filter((l) => boxOf(l) === b).map((l) => valueOf(ctx, l)));
    const hasTotal = totals.some((l) => boxOf(l) === b);
    return [b, BOX[b] ?? 'Other', mine.length, Math.round(gain * 100) / 100, hasTotal ? reported : null, hasTotal ? diff(gain, reported) : null];
  });
  const biggest = [...lots].sort((a, b) => Math.abs(valueOf(ctx, b)) - Math.abs(valueOf(ctx, a))).slice(0, 15);
  return {
    intro: `${lots.length} sales on Form 8949 are summarized by box so a reviewer is not buried in lines. Open the largest ones, or any line from the main list.`,
    tables: [
      {
        heading: 'Sales by Form 8949 box',
        columns: [{ label: 'Box' }, { label: 'What it covers' }, { label: 'Sales', num: true }, { label: 'Gain or loss, added up', num: true }, { label: 'Total on the form', num: true }, { label: 'Difference', num: true }],
        rows,
        note: 'A difference under a dollar is rounding. A larger one means the sales do not add up to the total the form reports for that box. Boxes with no total line show a dash.',
      },
      {
        heading: 'Largest 15 sales by size of gain or loss',
        columns: [{ label: 'Line' }, { label: 'Sale' }, { label: 'Gain or loss', num: true }],
        rows: biggest.map((l) => [link(l.key), l.label, valueOf(ctx, l)]),
      },
      lineTable(ctx, 'All sales on Form 8949', (l) => l.rule === 'R-8949-LOT' && typeof valueOf(ctx, l) === 'number', { note: true }),
      lineTable(ctx, 'Schedule D', (l) => l.form === 'SchD', {}),
    ],
  };
}
