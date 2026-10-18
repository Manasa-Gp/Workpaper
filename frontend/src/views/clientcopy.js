// views/clientcopy.js — the client's copy: a read-only view of the return, shown only to the client role.
//
// Called by: views/picker.js (left column, among the return-level panels).
// Reads:     events.js (filedEvent, filedValue, effectiveValue, amendmentsOf). Nothing here is saved.
// Shows the numbers exactly as filed once the Partner has filed; before that, the current draft numbers.
// No buttons, no notes, no checks: the client sees results, not the firm's working.

import { h } from '../dom.js';
import { num, dayTime } from '../format.js';
import { amendmentsOf, effectiveValue, filedEvent, filedValue } from '../events.js';

export function clientCopy(state) {
  if (state.role !== 'client') return null;

  const filed = filedEvent(state.events);
  const amended = amendmentsOf(state.events).length;
  const lines = state.index.current.lines.filter((l) => l.value !== null && l.value !== undefined);
  const valueOf = (line) => (filed ? (filedValue(state.events, line.key) ?? line.value) : effectiveValue(line, state.events));

  const groups = new Map();
  for (const line of lines) {
    const group = `${line.jurisdiction === 'california' ? 'California · ' : ''}${line.form}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(line);
  }

  return h('details', { class: 'client-copy', open: true },
    h('summary', {}, 'Your copy of the return ', h('span', { class: `pill ${filed ? 'p-pass' : 'p-info'}` }, filed ? 'Filed' : 'Draft')),
    h('p', { class: 'muted' }, filed
      ? `Filed ${dayTime(filed.at)}. These are the numbers as filed.${amended ? ` ${amended} correction${amended === 1 ? '' : 's'} made since (ask your accountant).` : ''}`
      : 'Your accountant is still preparing this. Numbers may change before it is filed.'),
    [...groups].map(([group, items]) => h('section', { class: 'client-group' },
      h('h3', {}, group),
      h('dl', { class: 'client-lines' }, items.flatMap((line) => {
        const v = valueOf(line);
        return [h('dt', {}, line.label), h('dd', {}, typeof v === 'number' ? num(v) : String(v))];
      })),
    )),
  );
}
