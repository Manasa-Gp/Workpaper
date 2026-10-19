// records/core.js — small helpers every record uses. A record is a function that reads the packet and returns tables.
//
// A table is { heading, columns: [{ label, num? }], rows: [[cell, ...]], note? }.
// A cell is a string, a number (shown with thousands separators, right aligned), null (shown as a dash),
// or { text, key } which draws a button that opens that line of the return.
// Nothing here is saved: a record is always built fresh from the packet and the events.

import { effectiveValue } from '../events.js';
import { lastYear } from '../trace.js';

/** What every record builder is given. */
export function context(state) {
  const { index, events } = state;
  const packet = index.packet;
  return { index, events, packet, lines: index.current.lines, rv: packet.return_versions[packet.return_versions.length - 1] };
}

export const link = (key) => ({ text: key, key });
export const valueOf = (ctx, line) => effectiveValue(line, ctx.events);
export const lineByKey = (ctx, key) => ctx.index.current.byKey.get(key);
export const ofForm = (ctx, ...forms) => ctx.lines.filter((l) => forms.includes(l.form));

/** Percent change, or null when there is no sensible base. */
export const pct = (now, was) => (typeof now === 'number' && typeof was === 'number' && was !== 0 ? Math.round(((now - was) / Math.abs(was)) * 1000) / 10 : null);
export const diff = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.round((a - b) * 100) / 100 : null);
export const sum = (list) => list.reduce((n, x) => n + (typeof x === 'number' ? x : 0), 0);
export const nice = (key) => String(key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * A table of lines. `pick` is a list of keys (shown in that order) or a function that chooses lines.
 * opts: prior (add a "Last year" column), rule (add the rule), note (add the note).
 */
export function lineTable(ctx, heading, pick, opts = {}) {
  const chosen = Array.isArray(pick)
    ? pick.map((k) => lineByKey(ctx, k)).filter(Boolean)
    : ctx.lines.filter(pick);
  const columns = [{ label: 'Line' }, { label: 'What it is' }, { label: 'This return', num: true }];
  if (opts.prior) columns.push({ label: 'Last year', num: true }, { label: 'Change', num: true });
  if (opts.rule) columns.push({ label: 'Rule' });
  if (opts.note) columns.push({ label: 'Note' });
  const rows = chosen.map((l) => {
    const now = valueOf(ctx, l);
    const row = [link(l.key), l.label, now];
    if (opts.prior) {
      const was = lastYear(ctx.index, l.key)?.value ?? null;
      row.push(was, diff(now, was));
    }
    if (opts.rule) row.push(l.rule ?? null);
    if (opts.note) row.push(l.note ?? null);
    return row;
  });
  return { heading, columns, rows, note: rows.length ? undefined : 'No lines of this kind on this return.' };
}
