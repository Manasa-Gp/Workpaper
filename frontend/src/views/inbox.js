// views/inbox.js — "My work": what is waiting on the person using the page, across every number.
//
// Called by: views/picker.js (top of the left column).
// Reads:     inboxFor() (events.js). It only sees events the server sent this role, so a private
//            question between other people never shows up here.
// Calls back: on.select(key) to jump to the number the item is about.

import { h } from '../dom.js';
import { inboxFor, todayDate } from '../events.js';
import { ROLES } from '../roles.js';
import { dueDay } from '../format.js';

const KIND = { question: 'Question', task: 'Task', point: 'Review point' };

export function inbox(state, on) {
  const items = inboxFor(state.events, ROLES[state.role].label, todayDate());
  const overdue = items.filter((i) => i.overdue).length;
  return h('details', { class: 'inbox', open: items.length > 0 },
    h('summary', {}, `My work (${items.length})`, overdue ? h('span', { class: 'pill p-fail' }, `${overdue} overdue`) : null),
    items.length
      ? h('ul', { class: 'inbox-list' }, items.map((i) => h('li', {},
          h('button', { type: 'button', class: 'linkish', onClick: () => on.select(i.claim) }, `${KIND[i.kind]} · ${i.claim}`),
          h('p', {}, i.text),
          h('p', { class: i.overdue ? 'overdue' : 'muted' }, `From ${i.from}${i.kind === 'task' ? ` · due ${dueDay(i.due)}${i.overdue ? ' (overdue)' : ''}` : ''}`),
        )))
      : h('p', { class: 'muted' }, 'Nothing is waiting on you.'),
  );
}
