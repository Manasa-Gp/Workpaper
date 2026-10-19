// views/standards.js — the Firm standards panel: the written rules, and the lines that break one.
//
// Called by: views/picker.js (left column). Shown to staff only.
// Reads:     standards.js. Nothing here is saved.
// Calls back: on.select(key) to jump to a line.

import { h } from '../dom.js';
import { num } from '../format.js';
import { standardsOf } from '../standards.js';
import { selfReviewsFor, varianceFor } from '../serverchecks.js';

const SHOWN = 10;

export function standards(state, on) {
  if (state.role === 'client') return null;
  const std = standardsOf(state.index.packet);
  const swings = varianceFor(state);
  const selfs = selfReviewsFor(state);
  const flags = swings.length + selfs.length;
  const v = std.variance_review;

  return h('details', { class: 'standards' },
    h('summary', {}, 'Firm standards ', h('span', { class: `pill ${flags ? 'p-warn' : 'p-pass'}` }, flags ? `${flags} to look at` : 'None broken')),
    h('h3', {}, 'The rules'),
    h('ol', { class: 'std-list' }, std.rules.map((r) => h('li', {}, r))),
    h('details', {},
      h('summary', {}, `Steps every return needs (${std.required_steps.length})`),
      h('ol', { class: 'std-list' }, std.required_steps.map((s) => h('li', {}, s))),
    ),
    h('h3', {}, `Moved more than ${v.flag_if_change_over_percent}% and ${num(v.and_over_amount)} since last year (${swings.length})`),
    swings.length ? h('ul', { class: 'std-flags' }, swings.slice(0, SHOWN).map((f) => h('li', {},
      h('button', { type: 'button', class: 'linkish', onClick: () => on.select(f.key) }, f.key), ` ${f.label}`,
      h('span', { class: 'muted' }, ` ${num(f.last)} → ${num(f.now)} (${f.pct === null ? 'from zero' : `${Math.round(f.pct)}%`})`),
    ))) : h('p', { class: 'muted' }, 'None.'),
    swings.length > SHOWN ? h('p', { class: 'muted' }, `Showing the ${SHOWN} biggest changes of ${swings.length}.`) : null,
    h('h3', {}, `Signed off by the person who adjusted it (${selfs.length})`),
    selfs.length ? h('ul', { class: 'std-flags' }, selfs.map((f) => h('li', {},
      h('button', { type: 'button', class: 'linkish', onClick: () => on.select(f.key) }, f.key), ` ${f.name}`,
    ))) : h('p', { class: 'muted' }, 'None.'),
    h('p', { class: 'muted' }, 'A swing is a reason to explain the number, not an error. Add a note on the line.'),
  );
}
