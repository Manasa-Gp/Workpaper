// views/topbar.js — title, role switcher, and the reset button (admin only).
//
// Called by: main.js render().
// Calls back into main.js through the `on` handlers it is given: on.role(roleKey), on.reset().

import { h, clear } from '../dom.js';
import { ROLES, actor, can } from '../roles.js';

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

  const doing = Object.entries({ note: 'add notes', evidence: 'add evidence', adjust: 'adjust numbers', verify: 'verify flagged checks', signoff: 'sign off' })
    .filter(([action]) => can(state.role, action))
    .map(([, text]) => text);
  const summary = state.role === 'admin' ? 'can reset saved work' : doing.length ? `can ${doing.join(', ')}` : 'can view only';

  const resetButton = can(state.role, 'reset')
    ? h(
        'button',
        {
          class: 'btn btn-quiet',
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
    h('div', { class: 'role' },
      h('label', { for: 'role-select' }, 'Acting as'),
      select,
      h('span', { class: 'role-note' }, `${who.name} ${summary}`),
      h('span', { class: 'role-note proto' }, 'Prototype: roles are enforced on this screen only, not by a server.'),
      resetButton,
    ),
  );
}
