// views/viewlogpage.js — "Who opened what": every view in the log, newest first.
//
// Called by: views/picker.js (left column). Shown only to roles that may read the log (roles.js 'viewlog').
// Reads:     state.allViews, which main.js loads while this panel is open.
// Calls back: on.viewLog(open) to start and stop loading, on.select(key) to jump to a line.

import { h } from '../dom.js';
import { dayTime } from '../format.js';
import { can } from '../roles.js';

const SHOWN = 40;

export function viewLogPage(state, on) {
  if (!can(state.role, 'viewlog')) return null;
  const all = state.allViews ? [...state.allViews].reverse() : null;
  return h('details', { class: 'view-log', open: state.viewLogOpen, onToggle: (e) => on.viewLog(e.target.open) },
    h('summary', {}, 'Who opened what', all ? ` (${all.length})` : ''),
    all === null ? h('p', { class: 'muted' }, state.viewLogOpen ? 'Loading…' : 'Open to load the log.') : null,
    all && !all.length ? h('p', { class: 'muted' }, 'Nothing has been opened yet.') : null,
    all && all.length ? h('ul', { class: 'inbox-list' }, all.slice(0, SHOWN).map((v) => h('li', {},
      h('p', {}, h('strong', {}, v.by?.name || 'Unknown'), ` (${v.by?.role ?? '?'}) opened `,
        v.kind === 'line'
          ? h('button', { type: 'button', class: 'linkish', onClick: () => on.select(v.target) }, v.target)
          : h('span', {}, v.target.startsWith('reveal:') ? `${v.target.slice(7)} (revealed)` : v.target)),
      h('p', { class: 'muted' }, dayTime(v.at)),
    ))) : null,
    all && all.length > SHOWN ? h('p', { class: 'muted' }, `Showing the latest ${SHOWN} of ${all.length}.`) : null,
  );
}
