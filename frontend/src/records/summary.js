// records/summary.js — R1 (return summary, tax computation) and R2 (area summaries, document index, payments).

import { context, diff, lineByKey, lineTable, link, nice, pct, sum, valueOf } from './core.js';
import { lastYear } from '../trace.js';

// ---------- R1 ----------

export function returnSummary(state) {
  const ctx = context(state);
  const keys = ['F1040.1z', 'F1040.2b', 'F1040.3b', 'F1040.4b', 'F1040.7', 'F1040.8', 'F1040.9', 'F1040.10', 'F1040.11', 'F1040.12', 'F1040.13', 'F1040.15', 'F1040.24', 'F1040.33', 'F1040.37'];
  const rows = keys.map((k) => lineByKey(ctx, k)).filter(Boolean).map((l) => {
    const now = valueOf(ctx, l);
    // Last year's return has no "total wages" line, so wages compare to its wages line.
    const was = (lastYear(ctx.index, l.key) ?? (l.key === 'F1040.1z' ? lastYear(ctx.index, 'F1040.1a') : null))?.value ?? null;
    return [link(l.key), l.label, now, was, diff(now, was), pct(now, was)];
  });
  const cols = [{ label: 'Line' }, { label: 'What it is' }, { label: 'This year', num: true }, { label: 'Last year', num: true }, { label: 'Change', num: true }, { label: '% change', num: true }];

  const s = ctx.rv.summary;
  const totals = {
    heading: `Totals as the engine computed them (${ctx.rv.version})`,
    columns: [{ label: 'Federal' }, { label: 'Amount', num: true }, { label: 'California' }, { label: 'Amount', num: true }],
    rows: [
      ['AGI', s.federal.agi, 'Total AGI', s.california.total_agi],
      ['Taxable income', s.federal.taxable_income, 'California AGI', s.california.ca_agi],
      ['Total tax', s.federal.total_tax, 'Total tax', s.california.total_tax],
      ['Payments', s.federal.payments, 'Payments', s.california.payments],
      ['Balance due', s.federal.balance_due, 'Balance due (negative is a refund)', s.california.balance_due],
      ['Penalty', s.federal.penalty, 'Penalty', s.california.penalty],
    ],
  };

  const versions = {
    heading: 'How the return moved between versions',
    columns: [{ label: 'Version' }, { label: 'Computed' }, { label: 'Federal tax', num: true }, { label: 'Federal balance', num: true }, { label: 'California tax', num: true }, { label: 'California balance', num: true }],
    rows: ctx.packet.return_versions.map((v) => [v.version, String(v.computed_at).slice(0, 10), v.summary.federal.total_tax, v.summary.federal.balance_due, v.summary.california.total_tax, v.summary.california.balance_due]),
  };
  return { intro: 'The main lines of the return against last year, and the totals for each version of the return.', tables: [{ heading: 'Main lines against last year', columns: cols, rows }, totals, versions] };
}

export function taxComputation(state) {
  const ctx = context(state);
  const path = ['F1040.11', 'F1040.12', 'F1040.13', 'F1040.14', 'F1040.15', 'F1040.16', 'F1040.17', 'F1040.18', 'F1040.19', 'F1040.20', 'F1040.22', 'F1040.23', 'F1040.24', 'F1040.25d', 'F1040.26', 'F1040.33', 'F1040.37'];
  const rates = ctx.rv.tax_effect_rates ?? {};
  return {
    intro: 'From adjusted gross income down to the balance due, with the rule that builds each line. Click a line to see its trail.',
    tables: [
      lineTable(ctx, 'From AGI to balance due', path, { rule: true }),
      lineTable(ctx, 'Other taxes (Schedule 2)', (l) => l.form === 'Sch2', { rule: true }),
      lineTable(ctx, 'Alternative minimum tax (Form 6251)', (l) => l.form === 'F6251', { rule: true }),
      {
        heading: 'Rates used to estimate the tax effect of an adjustment',
        columns: [{ label: 'Kind of number' }, { label: 'Federal per dollar', num: true }, { label: 'California per dollar', num: true }],
        rows: Object.entries(rates).map(([name, r]) => [nice(name), r.federal_per_dollar, r.california_per_dollar]),
        note: 'These are estimates. The engine cannot be rerun here, so the tax effect is the change times a rate.',
      },
    ],
  };
}

// ---------- R2 ----------

export function areaSummaries(state) {
  const ctx = context(state);
  const opts = { prior: true };
  return {
    intro: 'The return grouped by area: what came in, what came off, credits and other taxes, and what was paid.',
    tables: [
      lineTable(ctx, 'Income', ['F1040.1z', 'F1040.2b', 'F1040.3b', 'F1040.4b', 'F1040.7', 'Sch1.3', 'Sch1.5', 'F1040.9'], opts),
      lineTable(ctx, 'Adjustments and deductions', ['Sch1.15', 'Sch1.16', 'Sch1.17', 'F1040.10', 'SchA.17', 'F1040.13', 'F1040.14'], opts),
      lineTable(ctx, 'Credits and other taxes', ['F1040.19', 'Sch3.1', 'Sch3.8', 'Sch2.1', 'Sch2.4', 'Sch2.11', 'Sch2.12', 'F1040.23'], opts),
      lineTable(ctx, 'Payments', ['F1040.25d', 'F1040.26', 'Sch3.10', 'Sch3.11', 'F1040.33'], opts),
    ],
  };
}

export function documentIndex(state) {
  const ctx = context(state);
  const { index, packet } = ctx;
  const usedBy = new Map(); // document id -> the lines that cite something read from it
  for (const line of ctx.lines) {
    for (const ref of line.sources ?? []) {
      const docId = ref.startsWith('ev-') ? index.values.get(ref)?.document_id : null;
      if (!docId) continue;
      if (!usedBy.has(docId)) usedBy.set(docId, new Set());
      usedBy.get(docId).add(line.key);
    }
  }
  const rows = packet.documents.map((d) => {
    const n = usedBy.get(d.id)?.size ?? 0;
    return [d.id, d.title, d.document_type, d.page_count ?? null, d.received_at ? String(d.received_at).slice(0, 10) : null, n, n ? [...usedBy.get(d.id)][0] : null];
  }).map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6] ? link(r[6]) : null]);
  const unused = rows.filter((r) => r[5] === 0).length;
  return {
    intro: `Every document in the file and how many lines cite something read from it. ${unused} of ${rows.length} are not cited by any line (some, like letters and the engagement letter, are not meant to be).`,
    tables: [{
      heading: 'Documents',
      columns: [{ label: 'ID' }, { label: 'Title' }, { label: 'Type' }, { label: 'Pages', num: true }, { label: 'Received' }, { label: 'Lines using it', num: true }, { label: 'First line' }],
      rows,
    }],
  };
}

export function payments(state) {
  const ctx = context(state);
  const { packet } = ctx;
  const irs = packet.tax_agency_records.irs_account_transcript_2025;
  const tx = irs[irs.length - 1].transactions.filter((t) => typeof t.amount === 'number' && t.code === '670');
  const estimated = tx.filter((t) => /estimated/i.test(t.description));
  const extension = tx.filter((t) => /extension/i.test(t.description));
  const ftb = packet.tax_agency_records.ftb_account;
  const ftbPaid = ftb.tax_year_2025_payments;
  const val = (k) => { const l = lineByKey(ctx, k); return l ? valueOf(ctx, l) : null; };
  const compare = (name, key, label, agency) => [link(key), `${name} (${label})`, val(key), agency, diff(val(key), agency)];
  return {
    intro: 'Payments as the return shows them, against what the IRS and the Franchise Tax Board say they received.',
    tables: [
      {
        heading: 'The return against the agencies',
        columns: [{ label: 'Line' }, { label: 'Payment' }, { label: 'On the return', num: true }, { label: 'Agency record', num: true }, { label: 'Difference', num: true }],
        rows: [
          compare('Federal estimated payments', 'F1040.26', 'IRS transcript', sum(estimated.map((t) => t.amount))),
          compare('Payment with extension', 'Sch3.10', 'IRS transcript', sum(extension.map((t) => t.amount))),
          compare('California estimated payments', 'F540NR.72', 'FTB account', sum(ftbPaid.map((p) => p.amount))),
        ],
        note: 'A difference is not always an error. A payment can be held as a credit for another year; the lists below say which.',
      },
      {
        heading: 'IRS: payments received',
        columns: [{ label: 'Date' }, { label: 'What it was' }, { label: 'Amount', num: true }],
        rows: tx.map((t) => [t.date, t.description, t.amount]),
      },
      {
        heading: 'Franchise Tax Board: payments received',
        columns: [{ label: 'Date' }, { label: 'Tax year' }, { label: 'Amount', num: true }, { label: 'Note' }],
        rows: [
          ...ftbPaid.map((p) => [p.date, '2025', p.amount, p.note ?? null]),
          ...(ftb.tax_year_2024_payments_after_filing ?? []).map((p) => [p.date, '2024', p.amount, p.note ?? null]),
        ],
      },
      lineTable(ctx, 'Withholding and other credits', ['F1040.25a', 'F1040.25d', 'Sch3.11', 'F540NR.71'], {}),
    ],
  };
}
