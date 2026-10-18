// views/nextyear.js — the Next year panel: what rolls forward, what was left open, what to ask and plan.
//
// Called by: views/picker.js (left column). Shown to staff only.
// Reads:     carryforward.js. Nothing here is saved.

import { h } from '../dom.js';
import { dueDay, num } from '../format.js';
import { carryforward } from '../carryforward.js';

export function nextYear(state) {
  if (state.role === 'client') return null;
  const c = carryforward(state.index.packet);
  const table = (title, rows) => rows.length
    ? h('div', {},
      h('h3', {}, title),
      h('table', { class: 'carry' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Came in'), h('th', {}, 'Goes out'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.came === null ? '—' : num(r.came)), h('td', {}, num(r.goes))))),
      ))
    : null;
  const list = (title, items) => items.length ? h('div', {}, h('h3', {}, title), h('ul', { class: 'next-list' }, items.map((t) => h('li', {}, t)))) : null;

  return h('details', { class: 'next-year' },
    h('summary', {}, 'Next year'),
    c.opensFrom ? h('p', { class: 'muted' }, `The 2026 file opens ${dueDay(c.opensFrom.slice(0, 10))} for the next preparer.`) : null,
    table('Carried forward · federal', c.federal),
    table('Carried forward · California', c.california),
    list('Left open by the previous preparer (check each is still open)', c.leftOpen),
    list('Ask the client', c.askClient),
    c.federalDue.length ? h('p', {}, h('strong', {}, 'Federal estimates due '), c.federalDue.map(dueDay).join(' · ')) : null,
    c.californiaDue.length ? h('p', {}, h('strong', {}, 'California estimates due '), c.californiaDue.map(dueDay).join(' · ')) : null,
    c.safeHarbor ? h('p', { class: 'muted' }, c.safeHarbor) : null,
  );
}
