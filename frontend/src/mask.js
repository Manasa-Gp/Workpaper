// mask.js — hide sensitive numbers (SSNs, PINs, bank numbers) before they are drawn.
//
// Called by: views/source.js, for the records that are not documents (household, agency, timeline...).
// It never changes the packet: it returns a masked copy. A role cleared for sensitive data can
// choose to reveal the real values (see canSeeSensitive in roles.js); nobody sees them by accident.
//
// Two ways a secret can appear:
//   1. under a field whose name says what it is  ->  { "ssn": "666-74-3309" }
//   2. inside a sentence                          ->  "Taxpayer PIN 41207"

// Keys that hold a number which identifies a person or opens an account.
const LAST_FOUR = new Set(['ssn', 'routing', 'account', 'ptin', 'ptins']); // the last four digits stay, like a card statement
const HIDE_ALL = new Set(['ip_pin', 'ero_pin', 'pin']); // a PIN is a password: no digits stay

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const dots = (n) => '•'.repeat(n);

/** "666-74-3309" -> "•••-••-3309"; "4483019276" -> "••••••9276"; short values are hidden entirely. */
export function maskNumber(value) {
  const s = String(value);
  if (/^\d{3}-\d{2}-\d{4}$/.test(s)) return `•••-••-${s.slice(-4)}`;
  return s.length <= 4 ? dots(s.length) : dots(s.length - 4) + s.slice(-4);
}

/** Masks secrets written inside a sentence: SSNs, and any number after the word PIN. */
export function maskText(text) {
  return String(text).replace(SSN, (m) => maskNumber(m)).replace(/(\bPIN\s+)\d+/gi, (_, lead) => `${lead}${dots(6)}`);
}

/** A masked copy of any value (object, list, text). The original is not touched. */
export function maskDeep(value, key = '') {
  const name = key.toLowerCase();
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, key));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, k)]));
  if (HIDE_ALL.has(name)) return dots(6);
  if (LAST_FOUR.has(name)) return maskNumber(value);
  return typeof value === 'string' ? maskText(value) : value;
}

/** True when masking changes anything, so the page only offers "Reveal" where there is something hidden. */
export const hasSecrets = (value) => JSON.stringify(maskDeep(value)) !== JSON.stringify(value);
