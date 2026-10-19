// records/judgment.js — J3 completeness, and the log of recorded judgments (J2).
// Nothing here is saved; both are built fresh from the packet and the events.

import { context, link, ofForm, valueOf } from './core.js';
import { dayTime } from '../format.js';
import { DECISION_LABEL } from '../events.js';

const short = (t, n = 80) => (String(t).length > n ? `${String(t).slice(0, n)}…` : String(t));

/** Questionnaire answers that should leave a trace on the return, and the forms where the trace would be. */
const AREAS = [
  ['qa-02', 'Moved states during the year', ['F540NR']],
  ['qa-04', 'Dependent who is a full-time student', ['F8863']],
  ['qa-07', 'Foreign accounts or assets', ['F8938']],
  ['qa-10', 'Sale of rental or business property', ['F4797']],
  ['qa-11', 'Rental property', ['SchE']],
  ['qa-13', 'K-1 income', ['F8582', 'F7203']],
  ['qa-15', 'Digital assets', ['F8949']],
  ['qa-16', 'Business or side income', ['SchC']],
  ['qa-18', 'Equipment bought for the business', ['F4562-C', 'F4562-E']],
  ['qa-27', 'Health savings account', ['F8889']],
  ['qa-30', 'Nondeductible (backdoor) IRA', ['F8606']],
  ['qa-39', 'Non-cash charitable gifts', ['F8283']],
];

export function completeness(state) {
  const ctx = context(state);
  const { index, packet, rv } = ctx;

  const cited = new Set();
  for (const line of ctx.lines) for (const ref of line.sources ?? []) {
    const id = ref.startsWith('ev-') ? index.values.get(ref)?.document_id : ref.startsWith('doc:') ? ref.slice(4).split('#')[0] : null;
    if (id) cited.add(id);
  }
  const readPages = new Map(); // document id -> pages the pipeline read at least one value from
  for (const v of index.values.values()) {
    if (!readPages.has(v.document_id)) readPages.set(v.document_id, new Set());
    readPages.get(v.document_id).add(v.page);
  }
  const superseded = new Set(rv.documents_superseded ?? []);

  const uncited = packet.documents.filter((d) => !cited.has(d.id))
    .map((d) => [d.id, d.title, d.document_type, d.page_count ?? null, superseded.has(d.id) ? 'Replaced by a later document' : 'Not cited by any line']);

  const unread = [];
  for (const d of packet.documents) {
    const read = readPages.get(d.id) ?? new Set();
    const pages = (d.pages ?? []).map((p) => p.page).filter((n) => !read.has(n));
    if (pages.length) unread.push([d.id, d.title, d.page_count ?? null, pages.join(', '), cited.has(d.id) ? 'Yes' : 'No']);
  }

  const answers = new Map((packet.client?.questionnaire ?? []).map((q) => [q.id, q.answer]));
  const areaRows = AREAS.map(([id, topic, forms]) => {
    const lines = ofForm(ctx, ...forms).filter((l) => l.value !== null && l.value !== undefined);
    return [topic, short(answers.get(id) ?? '—', 70), forms.join(', '), lines.length, lines.length ? 'On the return' : 'Nothing on the return'];
  });

  const outside = [];
  for (const r of packet.household?.related_returns ?? []) {
    outside.push([r.who, short(r.return, 90), r.prepared_by, r.in_this_packet === false ? 'Not in the packet' : String(r.in_this_packet)]);
  }
  for (const d of rv.diagnostics ?? []) {
    if (['FBAR_OUTSIDE_RETURN', 'FORM_1099_FILING'].includes(d.code)) outside.push([d.code, short(d.message, 140), 'Not this return', d.severity]);
  }
  const stateReturns = [...new Set((packet.household?.residency ?? []).map((r) => r.state))];

  return {
    intro: `A check that nothing was left out. ${uncited.length} documents are cited by no line, ${unread.length} documents have pages the pipeline never read, and the areas below show which answers from the client have no trace on the return.`,
    tables: [
      { heading: 'Areas the client mentioned, against the return', columns: [{ label: 'Area' }, { label: 'Client’s answer' }, { label: 'Forms' }, { label: 'Lines', num: true }, { label: 'Result' }], rows: areaRows, note: 'Only the topics in this list are tested. A "Nothing on the return" row is a question to ask, not proof of an error.' },
      { heading: 'Filings outside this return', columns: [{ label: 'Who or what' }, { label: 'Return or issue' }, { label: 'Prepared by' }, { label: 'In the packet' }], rows: outside, note: `The client lived in ${stateReturns.join(' and ')} during the year. The only state return built here is California.` },
      { heading: 'Pages the pipeline never read', columns: [{ label: 'Doc' }, { label: 'Title' }, { label: 'Pages', num: true }, { label: 'Never read' }, { label: 'Cited by a line' }], rows: unread.slice(0, 80), note: unread.length > 80 ? `Showing 80 of ${unread.length}.` : 'Some pages (covers, instructions) hold nothing to read.' },
      { heading: 'Documents no line cites', columns: [{ label: 'Doc' }, { label: 'Title' }, { label: 'Type' }, { label: 'Pages', num: true }, { label: 'Why' }], rows: uncited },
    ],
  };
}

export function decisionsLog(state) {
  const ctx = context(state);
  const found = ctx.events.filter((e) => e.type === 'decision');
  const diligence = (ctx.rv.diagnostics ?? []).find((d) => d.code === 'DUE_DILIGENCE_REQUIRED');
  return {
    intro: `Every judgment call written down with the authority it rests on. ${found.length} recorded so far. Add one from the "Judgment" section on any line.`,
    tables: [{
      heading: 'Recorded judgments',
      columns: [{ label: 'When' }, { label: 'Who' }, { label: 'Kind' }, { label: 'Line' }, { label: 'Decision' }, { label: 'Authority' }],
      rows: found.map((e) => [dayTime(e.at), `${e.by.name} (${e.by.role})`, DECISION_LABEL[e.category] ?? e.category, link(e.claim), e.text, e.authority]),
      note: found.length ? undefined : `None yet.${diligence ? ` The engine reminds us: ${diligence.message}` : ''}`,
    }],
  };
}
