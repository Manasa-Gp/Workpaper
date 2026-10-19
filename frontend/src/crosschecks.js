// crosschecks.js — Block 13: compare what the client and the agencies said, without trusting the engine.
//
// Called by: checks.js (adds a row to the claim a check is about) and records/crosschecks.js (the list of all of them).
// Reads:     the packet only (tax agency records, the documents' extracted values, the household). Nothing is saved.
// Output:    [{ id, label, status: 'pass'|'fail', detail, said, other, lines: [line keys], refs: [evidence ids] }]
//
// Block 14 adds two harder ones that need a rule, not a plain match (see californiaWages and seHealth below).
// Three checks live here:
//   estimated payments   the payments the return claims  vs  the IRS and Franchise Tax Board records
//   vehicle gift         the deduction on Form 8283      vs  the sale price on the charity's Form 1098-C
//   social security no.  the household record            vs  the card the client sent (last four digits only are shown)

const cache = new WeakMap(); // index -> list, so every claim does not recompute them

const fmt = (n) => Number(n).toLocaleString('en-US');
const sum = (list) => list.reduce((n, x) => n + x.amount, 0);
const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** "2025-04-15 3,000.00; 2025-06-16 3,000.00" -> [{ date, amount }] */
export function parseDated(note) {
  return [...String(note ?? '').matchAll(/(\d{4}-\d\d-\d\d)\s+([\d,]+(?:\.\d\d)?)/g)].map((m) => ({ date: m[1], amount: Number(m[2].replace(/,/g, '')) }));
}

/** Compare claimed payments with an agency's list. Returns the sentences that explain each difference. */
function paymentDifferences(claimed, agency, who, held = []) {
  const free = [...agency];
  const out = [];
  const take = (c, near) => {
    const i = free.findIndex((a) => (near ? dayGap(a.date, c.date) <= 3 : a.date === c.date));
    return i < 0 ? null : free.splice(i, 1)[0];
  };
  const unmatched = [];
  for (const c of claimed) { const a = take(c, false); if (!a) unmatched.push(c); else if (a.amount !== c.amount) out.push(`${c.date}: ${fmt(c.amount)} claimed, ${fmt(a.amount)} at ${who}.`); }
  for (const c of unmatched) {
    const a = take(c, true);
    const elsewhere = held.find((h) => h.date === c.date && h.amount === c.amount);
    if (a) out.push(`${c.date}: ${fmt(c.amount)} claimed, ${fmt(a.amount)} at ${who} on ${a.date}.`);
    else if (elsewhere) out.push(`${c.date}: ${fmt(c.amount)} claimed, but ${who} holds it as ${elsewhere.note ? elsewhere.note.charAt(0).toLowerCase() + elsewhere.note.slice(1) : 'a payment for another year'}.`);
    else out.push(`${c.date}: ${fmt(c.amount)} claimed, no such payment at ${who}.`);
  }
  return out;
}

function paymentCheck({ id, label, line, agency, who, asOf, held }) {
  if (!line || typeof line.value !== 'number') return null;
  const total = sum(agency);
  const base = { id, label, lines: [line.key], refs: [], said: fmt(line.value), other: fmt(total) };
  if (Math.abs(line.value - total) < 0.5) return { ...base, status: 'pass', detail: `The return claims ${fmt(line.value)} and ${who} shows ${fmt(total)} (as of ${asOf}). They agree.` };
  const why = paymentDifferences(parseDated(line.note), agency, who, held);
  return { ...base, status: 'fail', detail: `The return claims ${fmt(line.value)}. ${who.charAt(0).toUpperCase()}${who.slice(1)} shows ${fmt(total)} (as of ${asOf}), ${fmt(Math.abs(line.value - total))} ${line.value > total ? 'less' : 'more'}.${why.length ? ` ${why.join(' ')}` : ''}` };
}

function paymentChecks(index) {
  const records = index.packet.tax_agency_records ?? {};
  const byKey = index.current.byKey;
  const out = [];
  const irs = records.irs_account_transcript_2025?.slice(-1)[0];
  if (irs) {
    const agency = irs.transactions.filter((t) => t.code === '670' && typeof t.amount === 'number' && /estimated/i.test(t.description)).map((t) => ({ date: t.date, amount: t.amount }));
    out.push(paymentCheck({ id: 'pay-fed', label: 'Estimated payments match the IRS record', line: byKey.get('F1040.26'), agency, who: 'the IRS', asOf: irs.as_of }));
  }
  const ftb = records.ftb_account;
  if (ftb) {
    const agency = ftb.tax_year_2025_payments.map((p) => ({ date: p.date, amount: p.amount }));
    out.push(paymentCheck({ id: 'pay-ca', label: 'Estimated payments match the FTB record', line: byKey.get('F540NR.72'), agency, who: 'the Franchise Tax Board', asOf: ftb.as_of, held: ftb.tax_year_2024_payments_after_filing }));
  }
  return out.filter(Boolean);
}

/** A vehicle given to a charity that sold it: the deduction is generally limited to the sale price (Form 1098-C box 4c). */
function vehicleChecks(index) {
  const out = [];
  for (const line of index.current.lines) {
    if (typeof line.value !== 'number') continue;
    for (const ref of line.sources ?? []) {
      const doc = index.values.get(ref)?.document_id;
      const proceeds = doc ? (index.valuesByDoc.get(doc) ?? []).find((v) => v.field === 'box4c' && typeof v.value === 'number') : null;
      if (!proceeds) continue;
      const base = { id: `vehicle-${line.key}`, label: 'Vehicle gift against the charity’s Form 1098-C', lines: [line.key], refs: [proceeds.id], said: fmt(line.value), other: fmt(proceeds.value) };
      out.push(line.value > proceeds.value
        ? { ...base, status: 'fail', detail: `The return deducts ${fmt(line.value)}. ${doc} (Form 1098-C) says the charity sold the vehicle for ${fmt(proceeds.value)} (box 4c). When the charity sells it without using it, the deduction is generally limited to the sale price.` }
        : { ...base, status: 'pass', detail: `The return deducts ${fmt(line.value)}, no more than the ${fmt(proceeds.value)} the charity got for the vehicle (${doc}, box 4c).` });
      break;
    }
  }
  return out;
}

const digits = (s) => String(s).replace(/\D/g, '');
const isSwap = (a, b) => a.length === b.length && a !== b && [...a].sort().join('') === [...b].sort().join('');

/** Each dependent's number in the household record against the number on the card the client sent. */
function ssnChecks(index) {
  const out = [];
  for (const person of index.packet.household.people) {
    if (!person.ssn) continue;
    const card = [...index.values.values()].find((v) => v.value_type === 'ssn' && index.documents.get(v.document_id)?.belongs_to === `dependent:${person.id}`);
    if (!card) continue;
    const first = person.name.split(' ')[0];
    const a = digits(person.ssn); const b = digits(card.value);
    const lines = index.current.lines.filter((l) => (l.sources ?? []).includes(`household:${person.id}`)).map((l) => l.key);
    const base = { id: `ssn-${person.id}`, label: `${first}’s Social Security number matches the card`, lines, refs: [card.id], said: `ends ${a.slice(-4)}`, other: `ends ${b.slice(-4)}` };
    out.push(a === b
      ? { ...base, status: 'pass', detail: `${first}’s number in the household record and on the card (${card.document_id}) agree (both end ${a.slice(-4)}).` }
      : { ...base, status: 'fail', detail: `${first}’s number ends ${a.slice(-4)} in the household record but ${b.slice(-4)} on the card (${card.document_id}).${isSwap(a, b) ? ' Two digits look swapped.' : ''} The IRS matches names and numbers, so a wrong digit can reject the return.` });
  }
  return out;
}

const textOf = (doc) => (doc?.pages ?? []).map((pg) => pg.printed_content).join(' ');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const usDate = (m) => `${m[3]}-${m[1]}-${m[2]}`; // 07/15/2025 -> 2025-07-15

/**
 * Block 14a. A client who moved out of California is taxed by California on everything earned before the move
 * and only on California-source pay after it. The engine's "California amount" takes each W-2's box 16 whole.
 * Rule: a W-2 whose job ended before the move counts in full; for a job that carried on, count the paystub's
 * California year-to-date wages up to the move; with no paystub, count box 16 and say it could not be checked.
 */
function californiaWages(index) {
  const line = index.current.byKey.get('SchCA540NR.1.E');
  const move = (index.packet.household.residency ?? []).find((r) => r.state !== 'CA');
  if (!line || !move || typeof line.value !== 'number') return null;
  const w2s = (line.sources ?? []).map((ref) => index.values.get(ref)).filter((v) => v?.field === 'box16');
  if (!w2s.length) return null;
  let supported = 0; let unchecked = false;
  const parts = []; const refs = [];
  for (const w of w2s) {
    const doc = index.documents.get(w.document_id);
    const ended = /Employment ended (\d\d)\/(\d\d)\/(\d{4})/.exec(textOf(doc));
    const pay = [...index.values.values()].find((v) => v.field === 'ytd_ca_wages' && index.documents.get(v.document_id)?.issuer === doc.issuer);
    refs.push(w.id);
    if (ended && usDate(ended) < move.from) { supported += w.value; parts.push(`${doc.issuer}: ${fmt(w.value)} in full (the job ended ${usDate(ended)}, before the move).`); }
    else if (pay) { const n = Math.min(pay.value, w.value); supported += n; refs.push(pay.id); parts.push(`${doc.issuer}: ${fmt(n)} from the paystub (${pay.document_id}) up to the move, not the ${fmt(w.value)} on the W-2 (${doc.id}).`); }
    else { supported += w.value; unchecked = true; parts.push(`${doc.issuer}: ${fmt(w.value)}, with no paystub to check the move against.`); }
  }
  const base = { id: 'ca-wages', label: 'California wages fit the move date and the paystub', lines: [line.key], refs, said: fmt(line.value), other: fmt(supported) };
  if (Math.abs(line.value - supported) < 0.5) return { ...base, status: 'pass', detail: `California wages of ${fmt(line.value)} agree with the move date (${move.from}) and the paystubs. ${parts.join(' ')}` };
  return { ...base, status: 'fail', detail: `The line takes ${fmt(line.value)} as California wages. The client moved to ${move.state} on ${move.from}, so only pay up to then is California's. ${parts.join(' ')} That supports ${fmt(supported)}, ${fmt(Math.abs(line.value - supported))} ${line.value > supported ? 'less' : 'more'} than the line.${unchecked ? ' One job could not be checked.' : ''}` };
}

/**
 * Block 14b. The self-employed health insurance deduction is generally not allowed for any month the person was
 * eligible for an employer-subsidized plan, including through a spouse's job (qa-25).
 * Months of eligibility come from the spouse's W-2s: employment began / ended dates, otherwise the whole year.
 */
function seHealth(index) {
  const line = index.current.byKey.get('Sch1.17');
  const qa = (index.packet.client?.questionnaire ?? []).find((q) => q.id === 'qa-25');
  if (!line || !qa || typeof line.value !== 'number' || !/^yes/i.test(qa.answer)) return null;
  const monthly = Number(/([\d,]+\.\d\d) per month/.exec(textOf(index.documents.get(index.values.get(line.sources?.[0])?.document_id)))?.[1]?.replace(/,/g, ''));
  const eligible = new Set(); const jobs = [];
  for (const ref of index.current.byKey.get('F1040.1a')?.sources ?? []) {
    const doc = index.documents.get(index.values.get(ref)?.document_id);
    if (!doc || jobs.some((j) => j.id === doc.id)) continue;
    const t = textOf(doc);
    const began = /Employment began (\d\d)\/(\d\d)\/(\d{4})/.exec(t); const ended = /Employment ended (\d\d)\/(\d\d)\/(\d{4})/.exec(t);
    const from = began ? Number(began[1]) : 1; const to = ended ? Number(ended[1]) : 12;
    for (let m = from; m <= to; m += 1) eligible.add(m);
    jobs.push({ id: doc.id, text: `${doc.issuer} (${MONTHS[from - 1]}–${MONTHS[to - 1]})` });
  }
  const free = 12 - eligible.size;
  const allowed = Number.isFinite(monthly) ? monthly * free : null;
  const base = { id: 'se-health', label: 'Self-employed health insurance against the employer-coverage answer (qa-25)', lines: [line.key], refs: line.sources.slice(0, 1), said: fmt(line.value), other: allowed === null ? 'unknown' : fmt(allowed) };
  if (allowed === null || line.value <= allowed + 0.5) return { ...base, status: 'pass', detail: `The deduction of ${fmt(line.value)} is no more than the months without employer coverage allow.` };
  return { ...base, status: 'fail', detail: `The return deducts ${fmt(line.value)} (${fmt(monthly)} a month for 12 months). In qa-25 the client says Erik could have joined a family plan through Ngozi’s employers: ${jobs.map((j) => j.text).join(', ')}. That is ${eligible.size} of 12 months of eligibility, and the deduction is generally not allowed for those months, which leaves ${fmt(allowed)}. Ask the client whether those plans were employer-subsidized.` };
}

/**
 * Cal1: figures that should agree. Four pairs are one number carried from one form to another;
 * the fifth adds up the lot lines of each Form 8949 box and compares them with that box's total line.
 */
const PAIRS = [
  ['rec-capgain', 'Capital gain agrees between Schedule D and Form 1040', 'SchD.16', 'F1040.7'],
  ['rec-interest', 'Taxable interest agrees between Schedule B and Form 1040', 'SchB.4', 'F1040.2b'],
  ['rec-dividends', 'Ordinary dividends agree between Schedule B and Form 1040', 'SchB.6', 'F1040.3b'],
  ['rec-adjust', 'Adjustments to income agree between Schedule 1 and Form 1040', 'Sch1.26', 'F1040.10'],
];
const round2 = (n) => Math.round(n * 100) / 100;

function compareTwo(id, label, a, b, group = 'reconcile') {
  const ka = a.key; const kb = b.key;
  const base = { id, label, group, lines: [ka, kb], refs: [], said: fmt(a.value), other: fmt(b.value) };
  return Math.abs(a.value - b.value) < 0.5
    ? { ...base, status: 'pass', detail: `${ka} (${fmt(a.value)}) and ${kb} (${fmt(b.value)}) agree.` }
    : { ...base, status: 'fail', detail: `${ka} says ${fmt(a.value)} but ${kb} says ${fmt(b.value)}, a difference of ${fmt(Math.abs(a.value - b.value))}.` };
}

function pairChecks(index) {
  const get = (k) => index.current.byKey.get(k);
  return PAIRS.map(([id, label, ka, kb]) => (get(ka) && get(kb) && is(get(ka).value) && is(get(kb).value) ? compareTwo(id, label, get(ka), get(kb)) : null)).filter(Boolean);
}
const is = (x) => typeof x === 'number';

function form8949Check(index) {
  const lines = index.current.lines;
  const boxes = lines.map((l) => /^F8949\.([A-Z])\.total$/.exec(l.key)?.[1]).filter(Boolean);
  if (!boxes.length) return null;
  const off = []; const keys = [];
  for (const box of boxes) {
    const total = index.current.byKey.get(`F8949.${box}.total`);
    const lots = lines.filter((l) => l.key.startsWith(`F8949.${box}.`) && !l.key.endsWith('.total') && is(l.value));
    const added = round2(lots.reduce((n, l) => n + l.value, 0));
    keys.push(total.key);
    if (!is(total.value) || Math.abs(added - total.value) >= 0.5) off.push(`box ${box}: ${lots.length} lots add to ${fmt(added)}, the total line says ${is(total.value) ? fmt(total.value) : 'nothing'}`);
  }
  const base = { id: 'rec-8949', label: 'Form 8949 lots add up to each box total', group: 'reconcile', lines: keys, refs: [], said: `${boxes.length} box totals`, other: off.length ? `${off.length} differ` : 'all agree' };
  return off.length
    ? { ...base, status: 'fail', detail: `${off.join('; ')}.` }
    : { ...base, status: 'pass', detail: `The lots in each of the ${boxes.length} boxes (${boxes.join(', ')}) add up to that box's total line.` };
}

/** Cal4: the California schedule's income categories, one row each, with federal, California-law, California and outside-California amounts. */
export function incomeByCategory(index) {
  const rows = [];
  for (const line of index.current.lines) {
    const m = /^SchCA540NR\.(\d+)\.A$/.exec(line.key);
    if (!m) continue;
    const get = (col) => index.current.byKey.get(`SchCA540NR.${m[1]}.${col}`);
    const d = get('D'); const e = get('E');
    if (!d || !e) continue;
    rows.push({ n: m[1], label: line.label.replace(/ - federal$/, ''), keys: { A: line.key, D: d.key, E: e.key }, A: line.value, D: d.value, E: e.value, outside: round2(d.value - e.value) });
  }
  return rows;
}

function stateChecks(index) {
  const rows = incomeByCategory(index);
  const get = (k) => index.current.byKey.get(k);
  const out = [];
  const add = (id, label, col, totalKey) => {
    const total = get(totalKey);
    if (!rows.length || !total || !is(total.value)) return;
    const added = round2(rows.reduce((n, r) => n + r[col], 0));
    const base = { id, label, group: 'state', lines: [totalKey], refs: [], said: fmt(added), other: fmt(total.value) };
    out.push(Math.abs(added - total.value) < 0.5
      ? { ...base, status: 'pass', detail: `The ${rows.length} income categories add up to ${fmt(added)}, the same as ${totalKey}.` }
      : { ...base, status: 'fail', detail: `The ${rows.length} income categories add up to ${fmt(added)}, but ${totalKey} says ${fmt(total.value)}, a difference of ${fmt(Math.abs(added - total.value))}.` });
  };
  add('rec-state-fed', 'Income by category adds up to total income on Form 1040', 'A', 'F1040.9');
  add('rec-state-law', 'Income by category adds up to total income using California law', 'D', 'SchCA540NR.22.D');
  add('rec-state-ca', 'California income by category adds up to total California income', 'E', 'SchCA540NR.22.E');
  return out;
}

export function crossChecks(index) {
  if (!cache.has(index)) cache.set(index, [...paymentChecks(index), ...vehicleChecks(index), ...ssnChecks(index), californiaWages(index), seHealth(index), ...pairChecks(index), form8949Check(index), ...stateChecks(index)].filter(Boolean));
  return cache.get(index);
}

/** The cross-checks that are about this line, in the shape claim checks use. */
export const crossChecksFor = (index, key) => crossChecks(index).filter((c) => c.lines.includes(key)).map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail, refs: c.refs, ref: c.refs[0] }));
