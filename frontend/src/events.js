// events.js — everything a person does is saved as an event, never as an overwrite.
//
// Called by: main.js (load/save) and views/claim.js (add events, read history).
// Storage:   the backend only (GET/PUT /api/events -> backend/data/events.json).
//            Failures are thrown so the screen can say "not saved" instead of hiding them.
//
// (keep your event shape and "engine value is never edited" comments here)

const API = '/api/events';

export async function loadEvents() {
  const response = await fetch(API);
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
  const changes = eventsFor(events, line.key).filter((e) => e.type === 'adjust' || e.type === 'revert');
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
