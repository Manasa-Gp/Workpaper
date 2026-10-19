// timebudget.js — hours recorded against the firm's budget for this return.
//
// Called by: views/timebudget.js (the Time against budget panel).
// Reads:     packet.firm.budget_hours (hours per area) and the 'time' events. Nothing here is saved by this file.
//
// A 'time' event is { area, hours, by, at }. Totals are always added up from the events, never stored.

const nice = (key) => String(key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const budgetOf = (packet) => packet.firm.budget_hours ?? {};
export const timeEvents = (events) => events.filter((e) => e.type === 'time' && typeof e.hours === 'number');

/** One row per budget area: { area, label, budget, spent, left, over }. */
export function timeRows(packet, events) {
  const spent = {};
  for (const e of timeEvents(events)) spent[e.area] = (spent[e.area] ?? 0) + e.hours;
  return Object.entries(budgetOf(packet)).map(([area, budget]) => {
    const used = spent[area] ?? 0;
    return { area, label: nice(area), budget, spent: used, left: budget - used, over: used > budget };
  });
}

export function timeTotals(rows) {
  const budget = rows.reduce((n, r) => n + r.budget, 0);
  const spent = rows.reduce((n, r) => n + r.spent, 0);
  return { budget, spent, over: spent > budget };
}

/** 1.5 -> "1.5", 2 -> "2" */
export const hours = (n) => String(Math.round(n * 100) / 100);
