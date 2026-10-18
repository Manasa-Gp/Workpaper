// format.js — number and date formatting shared by the views.

const usd0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 212400 -> "212,400". Non-numbers are returned as text. */
export function num(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return value === null || value === undefined ? '—' : String(value);
  return Number.isInteger(value) ? usd0.format(value) : usd2.format(value);
}

/** Signed dollar amount for tax effects: +1,234 / −1,234 */
export function signed(value) {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return (rounded > 0 ? '+' : '−') + usd0.format(Math.abs(rounded));
}

/** "2026-03-04T09:12:00Z" -> "Mar 4, 2026" */
export function day(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2026-10-31" -> "Oct 31, 2026" (a date with no time, read as that calendar day wherever you are) */
export function dueDay(date) {
  if (!date) return 'no deadline';
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2026-03-04T09:12:00Z" -> "Mar 4, 2026, 9:12 AM" */
export function dayTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
