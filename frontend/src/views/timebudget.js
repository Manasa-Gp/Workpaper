// views/timebudget.js — the Time against budget panel: hours recorded for each area, against the firm's budget.
//
// Called by: views/picker.js (left column). Shown to staff (not the client or the administrator).
// Calls back: on.add(event) to save a 'time' event (key RETURN).

import { h } from '../dom.js';
import { dayTime } from '../format.js';
import { actor, can, WHY_NOT } from '../roles.js';
import { newEvent, RETURN_KEY } from '../events.js';
import { hours, timeEvents, timeRows, timeTotals } from '../timebudget.js';

export function timeBudget(state, on) {
  if (state.role === 'client' || state.role === 'admin') return null;
  const rows = timeRows(state.index.packet, state.events);
  const total = timeTotals(rows);
  const recent = timeEvents(state.events).slice(-5).reverse();
  const who = actor(state.index.packet, state.role);

  const bar = (r) => h('div', { class: 'time-bar', role: 'img', 'aria-label': `${hours(r.spent)} of ${hours(r.budget)} hours` },
    h('span', { class: r.over ? 'over' : '', style: `width:${Math.min(100, r.budget ? (r.spent / r.budget) * 100 : 0)}%` }));

  const area = h('select', { id: 'time-area', 'aria-label': 'Area of work' }, rows.map((r) => h('option', { value: r.area }, r.label)));
  const amount = h('input', { id: 'time-hours', type: 'number', min: '0.25', max: '24', step: '0.25', placeholder: 'Hours', 'aria-label': 'Hours spent' });
  const add = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const value = Number(amount.value);
      if (!Number.isFinite(value) || value <= 0 || value > 24) return;
      const picked = rows.find((r) => r.area === area.value);
      on.add(newEvent({ claim: RETURN_KEY, type: 'time', by: { name: who.name, role: who.role }, area: area.value, hours: value, text: `Recorded ${hours(value)} h on ${picked?.label ?? area.value}.` }));
    },
  }, 'Record time');
  if (!can(state.role, 'time')) { add.setAttribute('disabled', ''); add.setAttribute('title', WHY_NOT.time); amount.setAttribute('disabled', ''); area.setAttribute('disabled', ''); }

  return h('details', { class: 'time-budget' },
    h('summary', {}, 'Time against budget ', h('span', { class: `pill ${total.over ? 'p-warn' : 'p-info'}` }, `${hours(total.spent)} of ${hours(total.budget)} h`)),
    h('div', { class: 'time-rows' }, rows.map((r) => h('div', { class: 'time-row' },
      h('p', {}, r.label, h('span', { class: `muted${r.over ? ' time-over' : ''}` }, `  ${hours(r.spent)} of ${hours(r.budget)} h${r.over ? ` · ${hours(-r.left)} over` : ''}`)),
      bar(r),
    ))),
    h('div', { class: 'time-form' }, area, amount, add),
    recent.length ? h('div', {}, h('h3', {}, 'Latest entries'), h('ul', { class: 'time-recent' }, recent.map((e) => h('li', { class: 'muted' }, `${hours(e.hours)} h · ${e.text ?? e.area} · ${e.by?.name ?? ''} · ${dayTime(e.at)}`)))) : null,
    h('p', { class: 'muted' }, 'Hours are added up from what people record. The budget comes from the engagement.'),
  );
}
