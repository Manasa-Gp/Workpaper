// notices.js — turns an agency letter into a self-contained answer: for every item the letter asks about,
// the number, how it was built, where it came from, and what the team wrote about it.
//
// Called by: views/notice.js (the Notices panel).
// Reads:     the packet (tax_agency_records.notices), trace.js, events.js. Nothing here is saved.
//
// Idea: the answer to "explain this number" is the number's own trail, so we do not write a new story,
// we just collect the trail that already exists and put it on one page.

import { traceClaim } from './trace.js';
import { effectiveValue, eventsFor, filedEvent, filedValue, signoffState } from './events.js';
import { maskSsn } from './filing.js';
import { day, dueDay, num } from './format.js';

// Which lines answer which question in a letter. A real system would match by form and line; the
// prototype lists the topics in the packet's letters. An item with no match still shows, with a warning.
const TOPICS = [
  { test: /charitable|schedule a line 12|8283/i, keys: ['SchA.12'] },
  { test: /gross receipts/i, keys: ['SchC.1'] },
];

export const noticesOf = (packet) => packet.tax_agency_records.notices ?? [];

/** Each question the letter asks, with the lines that answer it. */
export const noticeItems = (notice) =>
  (notice.items_under_examination ?? []).map((text) => ({ text, keys: TOPICS.find((t) => t.test.test(text))?.keys ?? [] }));

/** One source reference as a plain sentence. Social Security numbers are masked to the last four digits. */
export function describeSource(s) {
  let text;
  switch (s.kind) {
    case 'value':
      text = s.value
        ? `${s.doc?.title ?? s.value.document_id} (${s.value.document_id}), page ${s.value.page}: ${s.value.label} = ${s.value.text_as_read}`
        : `Document value ${s.ref} (not found)`;
      break;
    case 'client': {
      const i = s.item ?? {};
      text = `${s.type}: ${i.question ? `${i.question} → ${i.answer}` : (i.text ?? (i.notes ?? []).join(' ')) || s.ref}`;
      break;
    }
    case 'prior': text = `Last year's records (${s.pointer})`; break;
    case 'agency': text = `Agency records (${s.pointer})`; break;
    case 'param': text = `Rule parameter ${s.name}`; break;
    case 'asset': text = `Asset ${s.id}`; break;
    case 'person': text = `Household member ${s.person?.name ?? s.ref}`; break;
    case 'event': text = `Timeline: ${s.event?.event ?? s.ref}`; break;
    case 'unread': text = `Document ${s.doc?.id ?? s.ref}, page ${s.page}: never read by the extraction`; break;
    default: text = s.ref;
  }
  return text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, (m) => maskSsn(m));
}

/**
 * Everything we can say about one line: value (as filed, if filed), rule, sign-off, team notes, sources,
 * and the same for the lines it is built from (one level down, which is where a gift's paperwork lives).
 */
export function lineRecord(index, events, key, depth = 1) {
  const trace = traceClaim(index, key);
  if (!trace) return null;
  const { line } = trace;
  const filed = Boolean(filedEvent(events));
  const value = filed ? (filedValue(events, key) ?? effectiveValue(line, events)) : effectiveValue(line, events);
  const so = signoffState(line, events);
  return {
    key, label: line.label, value, rule: line.rule ?? 'none',
    signedOffBy: so.state === 'signed' ? so.last.by.name : null,
    notes: eventsFor(events, key).filter((e) => e.type === 'note' && !e.private && e.text).map((e) => ({ text: e.text, by: e.by?.name ?? '', at: e.at })),
    sources: trace.sources.map(describeSource),
    parts: depth > 0 ? trace.inputs.map((l) => lineRecord(index, events, l.key, depth - 1)).filter(Boolean) : [],
  };
}

/** The whole answer for one letter, as records (for the screen) and plain text (for copying). */
export function noticeAnswer(index, events, notice) {
  const items = noticeItems(notice).map((item) => ({ ...item, records: item.keys.map((k) => lineRecord(index, events, k)).filter(Boolean) }));
  return { notice, items, text: noticeText(notice, items) };
}

function noticeText(notice, items) {
  const out = [`Response record for ${notice.type} (${notice.id}), tax year ${notice.tax_year}`, `Letter dated ${dueDay(notice.dated)}${notice.response_due ? `, response due ${dueDay(notice.response_due)}` : ''}.`, ''];
  const put = (r, pad) => {
    out.push(`${pad}${r.label} (${r.key}): ${num(r.value)}`);
    out.push(`${pad}  Rule ${r.rule}${r.signedOffBy ? `; signed off by ${r.signedOffBy}` : '; not signed off'}`);
    r.sources.forEach((s) => out.push(`${pad}  Source: ${s}`));
    r.notes.forEach((n) => out.push(`${pad}  Note: ${n.text} (${n.by}, ${day(n.at)})`));
    r.parts.forEach((p) => put(p, `${pad}  `));
  };
  items.forEach((item, i) => {
    out.push(`${i + 1}. ${item.text}`);
    if (!item.records.length) out.push('   No line is linked to this question yet.');
    item.records.forEach((r) => put(r, '   '));
    out.push('');
  });
  return out.join('\n');
}
