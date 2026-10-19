// crosschecks.js — Block 13: compare what the client and the agencies said, without trusting the engine.
//
// Called by: checks.js (adds a row to the claim a check is about) and records/crosschecks.js (the list of all of them).
// Reads:     the packet only (tax agency records, the documents' extracted values, the household). Nothing is saved.
// Output:    [{ id, label, status: 'pass'|'fail', detail, said, other, lines: [line keys], refs: [evidence ids] }]
//
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

export function crossChecks(index) {
  if (!cache.has(index)) cache.set(index, [...paymentChecks(index), ...vehicleChecks(index), ...ssnChecks(index)]);
  return cache.get(index);
}

/** The cross-checks that are about this line, in the shape claim checks use. */
export const crossChecksFor = (index, key) => crossChecks(index).filter((c) => c.lines.includes(key)).map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail, refs: c.refs, ref: c.refs[0] }));
