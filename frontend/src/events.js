// events.js — everything a person does is saved as an event, never as an overwrite.
//
// Called by: main.js (load/save) and views/claim.js (add events, read history).
// Storage:   the backend only (GET/PUT /api/events -> backend/data/events.json).
//            Failures are thrown so the screen can say "not saved" instead of hiding them.
//
// (keep your event shape and "engine value is never edited" comments here)

const API = '/api/events';

/** The saved events this role may read (private questions between other people arrive as bare stubs). */
export async function loadEvents(role) {
  const response = await fetch(`${API}?${new URLSearchParams({ role })}`);
  if (!response.ok) throw new Error('Could not load events');
  return response.json();
}

/** Saves the whole list. Throws if the server does not accept it. */
/** Replaces the whole list. The server only allows this for the Administrator, so the role is sent too. */
export async function saveEvents(events, role) {
  const response = await fetch(`${API}?${new URLSearchParams({ role })}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(events),
  });
  if (!response.ok) throw new Error('Could not save events');
}
export async function appendEvent(event) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (response.status === 403) { // the server's rules refused it: retrying will never help
    const refused = new Error('The server refused this event');
    refused.rejected = true;
    throw refused;
  }
  if (!response.ok) throw new Error('Could not save the event');
}

export function newEvent(partial) {
  return { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), ...partial };
}

export const eventsFor = (events, claim) => events.filter((e) => e.claim === claim);

/** The 'verify' event that confirms a flagged check, or undefined. */
export const verifiedEvent = (events, claim, verifyKey) =>
  events.find((e) => e.claim === claim && e.type === 'verify' && e.check === verifyKey);

/** The number the workpaper currently stands behind. */
export function effectiveValue(line, events) {
  const changes = eventsFor(events, line.key).filter((e) => e.type === 'adjust' || e.type === 'revert' || e.type === 'amend');
  return changes.length ? changes[changes.length - 1].to : line.value;
}

/**
 * Why a claim cannot be signed off yet, or null if it can. The rule:
 *   - any warning or failure needs a note on the claim that explains it;
 *   - a check that asks for a person's confirmation needs that confirmation (Mark verified).
 * A passing check with nothing to confirm never blocks.
 */
const MIN_NOTE = 15;

export function signoffBlocker(checks, events, claim) {
  const mine = eventsFor(events, claim);
  if (filedEvent(events) && !mine.some((e) => e.type === 'amend')) return 'The return is filed and frozen. Only an amended line can be signed off.';
  const open = openReviewPoints(events, claim).length;
  if (open) return `${open} review point${open === 1 ? ' is' : 's are'} still open. Clear ${open === 1 ? 'it' : 'them'} before signing.`;
  const waiting = checks.filter((c) => c.verify && !verifiedEvent(events, claim, c.verifyKey));
  if (waiting.length) return 'A flagged check is waiting for verification. Click Mark verified first.';
  const problem = checks.find((c) => c.status === 'fail' || c.status === 'warn');
  // A note counts only if it is long enough to hold a reason ("hey" is not one). Judging the reason is the reviewer's job.
  if (problem && !mine.some((e) => e.type === 'note' && (e.text ?? '').trim().length >= MIN_NOTE)) {
    return `${problem.status === 'fail' ? 'A check failed' : 'A check shows a warning'}. Add a note explaining it (at least ${MIN_NOTE} characters) before signing.`;
  }
  return null;
}

/** 'none' | 'signed' | 'reopened' */
export function signoffState(line, events) {
  const signoffs = eventsFor(events, line.key).filter((e) => e.type === 'signoff');
  if (!signoffs.length) return { state: 'none' };
  const last = signoffs[signoffs.length - 1];
  const now = effectiveValue(line, events);
  return { state: last.valueAtSignoff === now ? 'signed' : 'reopened', last, now };
}

// ---------- tax effect of an adjustment ----------
//
// The brief says the engine cannot be rerun: multiply the change by the matching rate in
// return_versions[].tax_effect_rates. Only some lines have an obvious rate category here.
// Add more entries to extend it.

const CATEGORY = {
  'F1040.1a': 'wages',
  'F1040.1z': 'wages',
  'SchC.1': 'schc_profit',
};

export function taxEffect(version, lineKey, delta) {
  const category = CATEGORY[lineKey];
  const rate = category ? version.tax_effect_rates?.[category] : null;
  if (!rate) return null;
  return {
    category,
    federal: delta * rate.federal_per_dollar,
    california: delta * rate.california_per_dollar,
    estimated: true,
  };
}

/** Firm standard: an adjustment with a tax effect over this (federal or California) must be signed off by the Partner. */
export const PARTNER_OVER = 1000;

/** True if the line's latest change is an adjustment whose estimated tax effect is over PARTNER_OVER. */
export function needsPartner(events, claim) {
  const last = [...events].reverse().find((e) => e.claim === claim && ['adjust', 'revert', 'amend'].includes(e.type));
  const fx = last?.type === 'adjust' ? last.taxEffect : null;
  if (!fx) return false;
  return Math.max(Math.abs(fx.federal ?? 0), Math.abs(fx.california ?? 0)) > PARTNER_OVER;
}

/** Review points ('block' events) on a line that no 'clear' event has closed yet. They stop sign-off. */
export function openReviewPoints(events, claim) {
  const cleared = new Set(events.filter((e) => e.type === 'clear').map((e) => e.clears));
  return eventsFor(events, claim).filter((e) => e.type === 'block' && !cleared.has(e.id));
}

/** Every review point on a line with the event that cleared it (or null), oldest first. */
export function reviewPointsFor(events, claim) {
  return eventsFor(events, claim)
    .filter((e) => e.type === 'block')
    .map((b) => ({ b, c: events.find((e) => e.type === 'clear' && e.clears === b.id) ?? null }));
}

/** Assignments on a line ('assign' events), each with the 'done' event that closed it (or null), oldest first. */
export function assignmentsFor(events, claim) {
  return eventsFor(events, claim)
    .filter((e) => e.type === 'assign')
    .map((a) => ({ a, d: events.find((e) => e.type === 'done' && e.closes === a.id) ?? null }));
}

/** Today as 2026-10-18 (local calendar day). Passed into inboxFor so tests can fix the date. */
export const todayDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * "My work": everything waiting on this role, across all lines, most urgent first.
 *   question - asked of this role and not answered yet
 *   task     - assigned to this role and not done (overdue if its deadline is before today)
 *   point    - an open review point (the preparer is the one who must deal with those)
 * Private question stubs and events the server never sent simply do not appear here.
 */
export function inboxFor(events, roleLabel, today) {
  const items = [];
  const answered = new Set(events.filter((e) => e.type === 'answer').map((e) => e.answers));
  const done = new Set(events.filter((e) => e.type === 'done').map((e) => e.closes));
  const cleared = new Set(events.filter((e) => e.type === 'clear').map((e) => e.clears));
  for (const e of events) {
    if (e.type === 'question' && !e.private && e.to === roleLabel && !answered.has(e.id)) {
      items.push({ kind: 'question', claim: e.claim, text: e.text, from: e.by.name, at: e.at, due: null, overdue: false });
    } else if (e.type === 'assign' && e.to === roleLabel && !done.has(e.id)) {
      items.push({ kind: 'task', claim: e.claim, text: e.text, from: e.by.name, at: e.at, due: e.due || null, overdue: Boolean(e.due) && e.due < today });
    } else if (e.type === 'block' && roleLabel === 'Preparer' && !cleared.has(e.id)) {
      items.push({ kind: 'point', claim: e.claim, text: e.text, from: e.by.name, at: e.at, due: null, overdue: false });
    }
  }
  const rank = (i) => (i.overdue ? 0 : i.due ? 1 : 2);
  return items.sort((a, b) => rank(a) - rank(b) || (a.due ?? '9').localeCompare(b.due ?? '9') || a.at.localeCompare(b.at));
}

// ---------- presenting the return and the client's approval ----------

/** Words for each kind of event, used by the line history and the activity list. */
export const DECISION_LABEL = { election: 'Election', due_diligence: 'Due diligence', penalty: 'Penalty', judgment: 'Judgment call' };

export const EVENT_LABEL = {
  note: 'Note', adjust: 'Adjusted', signoff: 'Signed off', revert: 'Reverted', verify: 'Verified',
  evidence: 'Evidence added', question: 'Question', answer: 'Answer', block: 'Review point', clear: 'Review point cleared',
  assign: 'Assigned', done: 'Task done', present: 'Presented for approval', approve: 'Approved and signed',
  file: 'Filed and frozen', amend: 'Amended after filing', time: 'Time recorded', decision: 'Judgment recorded', undo: 'Batch undone',
};

// ---------- freeze at filing, amend on top ----------

/** The Partner's 'file' event (it holds the snapshot), or undefined while the return is open. */
export const filedEvent = (events) => [...events].reverse().find((e) => e.type === 'file');

/** Every number on the return as it stands now: the snapshot the 'file' event keeps. */
export function snapshotOf(lines, events) {
  const out = {};
  for (const l of lines) if (l.value !== null && l.value !== undefined) out[l.key] = effectiveValue(l, events);
  return out;
}

/** Amendments made after filing, oldest first. */
export const amendmentsOf = (events) => events.filter((e) => e.type === 'amend');

/** The number as it was filed (null before filing or for a line that was not in the snapshot). */
export const filedValue = (events, key) => filedEvent(events)?.snapshot?.[key] ?? null;

/** Events about the whole return (not one line) are saved under this key. */
export const RETURN_KEY = 'RETURN';

/**
 * A short fingerprint of every number on the return as it stands now (engine values plus adjustments).
 * If any number changes, the fingerprint changes. Same numbers always give the same text, in any browser.
 */
export function returnFingerprint(lines, events) {
  let hash = 0x811c9dc5; // FNV-1a, a small well-known hash
  const text = lines
    .filter((l) => l.value !== null && l.value !== undefined)
    .map((l) => `${l.key}=${effectiveValue(l, events)}`)
    .join('|');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${text.length}`;
}

/** The people who must sign a joint return: the taxpayer and the spouse. */
export const signersOf = (packet) => packet.household.people.filter((p) => p.role === 'taxpayer' || p.role === 'spouse').map((p) => p.name);

/** Where the return is in approval: 'none' | 'presented' | 'partly' | 'approved' | 'stale' (numbers changed after presenting). */
export function approvalState(events, fingerprint, signers) {
  const presents = events.filter((e) => e.type === 'present');
  const present = presents[presents.length - 1] ?? null;
  if (!present) return { state: 'none', present: null, signed: [], missing: signers };
  const signed = events.filter((e) => e.type === 'approve' && e.presents === present.id);
  const names = new Set(signed.map((e) => e.signer));
  const missing = signers.filter((n) => !names.has(n));
  let state = 'presented';
  if (present.fingerprint !== fingerprint) state = 'stale';
  else if (!missing.length) state = 'approved';
  else if (signed.length) state = 'partly';
  return { state, present, signed, missing };
}

/** Review points still open on any line (they stop the return being presented). */
export const allOpenReviewPoints = (events) => {
  const cleared = new Set(events.filter((e) => e.type === 'clear').map((e) => e.clears));
  return events.filter((e) => e.type === 'block' && !cleared.has(e.id));
};

/** The questions on a line, each with its answer (or null), oldest first. */
export function questionsFor(events, claim) {
  return eventsFor(events, claim)
    .filter((e) => e.type === 'question')
    .map((q) => ({ q, a: events.find((e) => e.type === 'answer' && e.answers === q.id) ?? null }));
}

/** How many questions on this line are still waiting for an answer. */
export const openQuestionCount = (events, claim) => questionsFor(events, claim).filter((p) => !p.a && !p.q.private).length;
