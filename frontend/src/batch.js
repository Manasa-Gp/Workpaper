// batch.js — Ch4 (many at once, with undo) and Ch3 (what-ifs). Pure helpers; main.js saves what they return.
//
// A batch is several ordinary events that share one `batch` id. "Undo" adds one 'undo' event naming that id;
// the server then stops sending those events, so the file keeps the history but the screen no longer shows them.
// A what-if is never an event at all: it lives in state.tryIt (memory) and disappears on reload.

import { claimChecks } from './checks.js';
import { traceClaim } from './trace.js';
import { effectiveValue, newEvent, taxEffect, verifiedEvent, RETURN_KEY } from './events.js';

const newBatchId = () => `batch-${Date.now()}`;

/** Events for "add this note to every selected line" or "mark every waiting check on the selected lines verified". */
export function buildBatch(state, kind, text, who) {
  const id = newBatchId();
  const by = { name: who.name, role: who.role };
  const events = [];
  let skipped = 0;
  for (const key of state.selected) {
    if (kind === 'note') {
      events.push(newEvent({ claim: key, type: 'note', batch: id, by, text }));
      continue;
    }
    const trace = traceClaim(state.index, key);
    const line = trace?.line;
    if (!line) { skipped += 1; continue; }
    const waiting = claimChecks(state.index, trace, effectiveValue(line, state.events))
      .filter((c) => c.verify && !verifiedEvent(state.events, key, c.verifyKey));
    if (!waiting.length) { skipped += 1; continue; }
    for (const c of waiting) events.push(newEvent({ claim: key, type: 'verify', batch: id, check: c.verifyKey, by, text: 'Confirmed the copy is counted once.' }));
  }
  return { id, events, skipped };
}

/** The newest batch still showing on screen: { id, count } or null. */
export function lastBatch(events) {
  const mine = events.filter((e) => e.batch && e.type !== 'undo');
  if (!mine.length) return null;
  const id = mine[mine.length - 1].batch;
  return { id, count: mine.filter((e) => e.batch === id).length };
}

export const undoEvent = (batch, who) => newEvent({ claim: RETURN_KEY, type: 'undo', batch: batch.id, by: { name: who.name, role: who.role }, text: `Undid a batch of ${batch.count} changes.` });

/** Drop events a later 'undo' took back (the server does this too; this covers the moment before it answers). */
export function withoutUndone(events) {
  const undone = new Set(events.filter((e) => e.type === 'undo').map((e) => e.batch));
  return events.filter((e) => e.type === 'undo' || !undone.has(e.batch));
}

/** What the what-ifs add up to: how many numbers are tried and their summed estimated tax effect. */
export function tryTotals(state) {
  let federal = 0; let california = 0; let mapped = 0;
  for (const [key, to] of state.tryIt) {
    const line = state.index.current.byKey.get(key);
    if (!line) continue;
    const fx = taxEffect(state.index.current, key, to - effectiveValue(line, state.events));
    if (fx) { federal += fx.federal; california += fx.california; mapped += 1; }
  }
  return { tried: state.tryIt.size, mapped, federal, california };
}
