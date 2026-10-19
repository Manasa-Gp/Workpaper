// serverchecks.js — the screen asks the server for every check and only displays the answer.
// All the rules live in backend/checks.py. Nothing is worked out in the browser.

const RANK = { fail: 3, warn: 2, pass: 1, na: 0 };
const OK = { status: 'pass', detail: '' };

export async function loadChecks() {
  const res = await fetch('/api/checks');
  if (!res.ok) throw new Error('no checks');
  return res.json();
}

/** The most serious status in a list of checks (fail, then warn, then pass, then na). */
export const worst = (checks) =>
  checks.reduce((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), 'na');

/** The server's checks for one claim. Empty until the server has answered. */
export function checksFor(state, trace) {
  return state.serverChecks?.claims?.[trace.line.key]?.checks ?? [];
}

/** Cross-checks against agencies and documents (for the Records pages). */
export const crossFor = (state) => state.serverChecks?.cross ?? [];

/** Income by category, federal / California law / California / outside California. */
export const incomeFor = (state) => state.serverChecks?.income ?? [];

/** Lines that moved too far against last year (each says whether a reason was written), and sign-offs by the same person who adjusted. */
export const varianceFor = (state) => state.serverChecks?.variance ?? [];
export const selfReviewsFor = (state) => state.serverChecks?.selfReviews ?? [];

/** Sign-off of one line as the server sees it: { state: 'none' | 'signed' | 'reopened', last?, now? }. */
export const signoffFor = (state, key) => state.serverChecks?.signoffs?.[key] ?? { state: 'none' };

/** Where the return is in approval (state, present, signed, missing, signers, fingerprint). The server works out the fingerprint too. */
export const approvalFor = (state) => state.serverChecks?.approval ?? { state: 'none', present: null, signed: [], missing: [], signers: [], fingerprint: '' };

/** Why the server would refuse this role's sign-off of the open line right now: a sentence, null if allowed, undefined while it answers. */
export const signoffProblemFor = (state, key) => (state.signoffCheck?.key === key && state.signoffCheck.role === state.role ? state.signoffCheck.problem : undefined);

export async function loadSignoffCheck(key, roleKey) {
  const res = await fetch(`/api/signoff-check?claim=${encodeURIComponent(key)}&as=${encodeURIComponent(roleKey)}`);
  if (!res.ok) return null;
  return (await res.json()).problem ?? null;
}

/** The books-to-taxable-income bridge: { rows, unexplained, unknown } or null. */
export const bridgeFor = (state) => state.serverChecks?.bridge ?? null;

/** Does an extracted value match the printed page? Missing from the server's list means yes. */
export const printedFor = (state, valueId) => state.serverChecks?.printed?.[valueId] ?? OK;

/** Is a document a probable copy of another one? */
export const dupDocFor = (state, docId) => state.serverChecks?.docs?.[docId] ?? OK;

/** Is a page a second scan of another page? */
export const dupPageFor = (state, docId, page) => state.serverChecks?.pages?.[`${docId}:${page}`] ?? OK;
