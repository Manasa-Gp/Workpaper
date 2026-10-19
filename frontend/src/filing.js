// filing.js — what happened after the return was approved: extension, e-file attempts, payments.
//
// Called by: views/filing.js (the Filing panel) and views/claim.js (the e-file rejection on a line).
// Reads:     only the packet (timeline, tax_agency_records, return_versions). Nothing here is saved.
//
// Two ideas:
//   1. The timeline merges the firm's own timeline with what the IRS and FTB say (their records are
//      the proof: a return is only "filed" when the agency accepted it).
//   2. A rejection is shown against the lines it concerns, with the evidence that explains the fix.

const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

/** The current return's totals (the latest version), used to fill in amounts the agency record leaves as words. */
const latestSummary = (packet) => packet.return_versions[packet.return_versions.length - 1].summary;

/** The agency's own account of what it did, newest "as of" date. */
const latestTranscript = (packet) => {
  const all = packet.tax_agency_records.irs_account_transcript_2025;
  return all[all.length - 1];
};

/**
 * One list, oldest first, of everything that moved the return toward and past filing.
 * Each item: { at, kind, title, detail, status?, refs[], dateOnly? }. `dateOnly` means the agency gave a day, not a time,
 * so the screen shows the day alone (and the item is placed at the end of that day).
 */
export function filingTimeline(packet) {
  const items = [];
  const timeline = new Map(packet.timeline.map((e) => [e.event, e]));
  const summary = latestSummary(packet);
  const transcript = latestTranscript(packet).transactions;

  const extension = timeline.get('extension_filed_with_payment');
  const paidWithExtension = transcript.find((t) => t.code === '670' && /extension/i.test(t.description));
  const extendedTo = transcript.find((t) => t.code === '460')?.description.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  if (extension) {
    items.push({
      at: extension.at, kind: 'extension', title: 'Extension filed with payment',
      detail: `Form 4868${paidWithExtension ? ` with ${money(paidWithExtension.amount)} paid` : ''}${extendedTo ? `; time to file extended to ${extendedTo}` : ''}.`,
      refs: extension.refs,
    });
  }

  const signed = timeline.get('client_approved_and_signed_8879');
  if (signed) {
    // The packet's own note lists the signers' PINs. They are deliberately not copied onto the screen.
    items.push({ at: signed.at, kind: 'signed', title: 'Client signed Form 8879 and FTB 8879', detail: 'Signed electronically, authorising the firm to e-file.', refs: signed.refs });
  }

  for (const s of packet.tax_agency_records.efile) {
    const who = s.jurisdiction === 'federal' ? 'Federal' : 'California';
    const title = {
      accepted: `${who} return accepted`,
      rejected: `${who} return rejected`,
      not_transmitted: `${who} return held (not sent)`,
    }[s.status] ?? `${who} return: ${s.status}`;
    items.push({
      at: s.date, kind: 'efile', status: s.status, jurisdiction: s.jurisdiction, title,
      detail: `Submission ${s.submission_id}.${(s.errors ?? []).length ? ` ${s.errors.map((e) => e.code).join(', ')}.` : ''}`,
      refs: [],
    });
  }

  const assessed = transcript.find((t) => t.code === '150');
  if (assessed) items.push({ at: `${assessed.date}T23:59:00Z`, dateOnly: true, kind: 'assessed', title: 'IRS recorded the return as filed', detail: `Tax assessed: ${money(summary.federal.total_tax)} (from the return as filed).`, refs: [] });

  const paid = timeline.get('federal_balance_paid');
  if (paid) items.push({ at: paid.at, kind: 'payment', title: 'Federal balance paid', detail: `${money(summary.federal.balance_due)} paid by direct debit, after the April 15 due date.`, refs: paid.refs });

  const penalty = transcript.find((t) => t.code === '196/276');
  if (penalty) items.push({ at: `${penalty.date}T23:59:00Z`, dateOnly: true, kind: 'penalty', title: 'IRS charged interest and a failure-to-pay penalty', detail: 'Amounts computed by the IRS, because the balance was paid after April 15.', refs: [] });

  const refund = timeline.get('california_refund_issued');
  if (refund) items.push({ at: refund.at, kind: 'refund', title: 'California refund issued', detail: `${money(Math.abs(summary.california.balance_due))} refunded by direct deposit.`, refs: refund.refs });

  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** Where each agency stands now: the last submission for that jurisdiction decides. */
export function filingStatus(packet) {
  const efile = packet.tax_agency_records.efile;
  const last = (jurisdiction) => [...efile].filter((s) => s.jurisdiction === jurisdiction).sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null;
  const federal = last('federal');
  const california = last('california');
  const transcript = latestTranscript(packet).transactions;
  const extendedTo = transcript.find((t) => t.code === '460')?.description.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const filedOn = federal?.status === 'accepted' ? federal.date.slice(0, 10) : null;
  return {
    federal, california, extendedTo, filedOn,
    // "On time" means accepted no later than the extended due date.
    onTime: Boolean(filedOn && extendedTo && filedOn <= extendedTo),
    allAccepted: federal?.status === 'accepted' && california?.status === 'accepted',
  };
}

// ---------- rejections ----------

/**
 * What a rejection code means and which lines it touches. A real system would hold a catalogue of
 * the agency's codes; this prototype lists the ones in the packet. Unknown codes still show their
 * message, just without a fix.
 */
const CATALOGUE = {
  'R0000-504-02': {
    title: 'A dependent’s name and Social Security number do not match the agency’s records',
    // Lines whose amount depends on a dependent being identified correctly.
    lines: ['F1040.19', 'F8812.4', 'F8812.6', 'F2441.2', 'F540NR.39'],
    why: 'This line depends on a dependent being identified correctly. If the agency cannot match the dependent, the credit or exemption cannot be allowed.',
  },
};

/**
 * Every rejection in the agency's e-file record, each with:
 *   held        submissions the other agency did not receive because of this one
 *   resolvedBy  the next accepted submission for the same agency (null if still open)
 *   help        what the code means, the lines it concerns, and the evidence for the fix
 */
export function rejections(packet, mismatches = {}) {
  const efile = packet.tax_agency_records.efile;
  const out = [];
  for (const s of efile.filter((x) => x.status === 'rejected')) {
    for (const error of s.errors ?? []) {
      const entry = CATALOGUE[error.code] ?? null;
      out.push({
        submission: s,
        error,
        held: efile.filter((x) => x.status === 'not_transmitted' && x.date === s.date),
        resolvedBy: efile.filter((x) => x.jurisdiction === s.jurisdiction && x.status === 'accepted' && x.date > s.date).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
        help: entry ? { ...entry, mismatch: mismatches[error.message] ?? null } : null,
      });
    }
  }
  return out;
}

/** The rejections that concern one line (empty for most lines). */
export const rejectionsForLine = (packet, lineKey, mismatches) => rejections(packet, mismatches).filter((r) => r.help?.lines.includes(lineKey));
