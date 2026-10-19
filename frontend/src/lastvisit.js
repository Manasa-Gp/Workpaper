// lastvisit.js — Ch1: "what changed since I last looked".
//
// Called by: main.js (remembers the time) and views/picker.js (marks lines, filters the list).
// Saved:     only in this browser (localStorage), one time per role. Never sent to the server.
// A line is "new" when someone ELSE added an event to it after that time. Your own work is not new to you.

const keyFor = (roleKey) => `trail:lastVisit:${roleKey}`;

export function readSince(roleKey) {
  try { return localStorage.getItem(keyFor(roleKey)); } catch { return null; }
}

export function writeSince(roleKey, iso = new Date().toISOString()) {
  try { localStorage.setItem(keyFor(roleKey), iso); } catch { /* private window: no memory, no markers */ }
  return iso;
}

/** line key -> how many events by other people arrived after `since`. Empty when there is no earlier visit. */
export function newByKey(events, since, myName) {
  const out = new Map();
  if (!since) return out;
  const cutoff = Date.parse(since);
  for (const e of events) {
    if (!e.claim || e.by?.name === myName || !(Date.parse(e.at) > cutoff)) continue;
    out.set(e.claim, (out.get(e.claim) ?? 0) + 1);
  }
  return out;
}
