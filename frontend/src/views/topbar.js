// views/topbar.js — title, role switcher, and the reset button (admin only).
//
// Called by: main.js render().
// Calls back into main.js through the `on` handlers it is given: on.role(roleKey), on.reset().

import { h, clear } from '../dom.js';
import { ROLES, actor, can } from '../roles.js';
import { pagesFor } from './pages.js';

let confirmingReset = false;

export function renderTopbar(el, state, on) {
  clear(el);
  const who = actor(state.index.packet, state.role);

  const select = h(
    'select',
    { id: 'role-select', 'aria-label': 'Act as', onChange: (e) => on.role(e.target.value) },
    Object.entries(ROLES).map(([key, role]) => {
      const name = actor(state.index.packet, key).name;
      return h('option', { value: key, selected: key === state.role }, `${role.label} · ${name}`);
    }),
  );

  const doing = Object.entries({ note: 'add notes', evidence: 'add evidence', ask: 'ask questions', answer: 'answer questions', viewlog: 'see who viewed', adjust: 'adjust numbers', amend: 'amend filed numbers', verify: 'verify flagged checks', signoff: 'sign off', block: 'raise review points', clear: 'clear review points', assign: 'assign work', present: 'present the return for approval', approve: 'approve and e-sign the return', file: 'mark the return filed', time: 'record time' })
    .filter(([action]) => can(state.role, action))
    .map(([, text]) => text);
  const summary = state.role === 'admin' ? 'can reset saved work' : doing.length ? `can ${doing.join(', ')}` : 'can view only';

  const resetButton = can(state.role, 'reset')
    ? h(
        'button',
        {
          class: 'btn btn-quiet reset-btn',
          type: 'button',
          onClick: () => {
            if (!confirmingReset) {
              confirmingReset = true;
              renderTopbar(el, state, on);
              return;
            }
            confirmingReset = false;
            on.reset();
          },
        },
        confirmingReset ? 'Click again to erase all notes, adjustments and sign-offs' : 'Reset saved work',
      )
    : null;

  el.append(
    h('div', { class: 'brand' },
      h('span', { class: 'brand-name' }, 'Trail'),
      h('span', { class: 'brand-sub' }, `${state.index.packet.packet.name} · ${state.index.current.version} (${state.index.current.computed_at.slice(0, 10)})`),
    ),
    h('nav', { class: 'pagenav', 'aria-label': 'Pages' },
      pagesFor(state.role).map((p) => h('button', {
        type: 'button', class: `pagetab${state.page === p.id ? ' is-on' : ''}`,
        'aria-current': state.page === p.id ? 'page' : null, onClick: () => on.page(p.id),
      }, p.label)),
    ),
    h('div', { class: 'role' },
      h('label', { for: 'role-select' }, 'Acting as'),
      select,
      h('span', { class: 'role-note' }, `${who.name} ${summary}`),
    ),
    ...[resetButton].filter(Boolean), // el.append(null) would print the word "null"; on its own at the far right of the bar, away from the role picker
  );
}
