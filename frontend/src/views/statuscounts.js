// views/statuscounts.js — one row of counts above the list: how far along the return is.
//
// Called by: views/picker.js (above the search box). Shown to staff only.
// Reads:     standards.js statusCounts(). Nothing here is saved.

import { h } from '../dom.js';
import { statusCounts } from '../standards.js';

export function statusBar(state) {
  if (state.role === 'client') return null;
  const c = statusCounts(state);
  const chip = (cls, text) => h('span', { class: `count-chip ${cls}` }, text);
  return h('div', { class: 'status-counts', 'aria-label': 'Status of every number' },
    chip('s-pass', `✓ ${c.pass} pass`),
    chip('s-warn', `! ${c.warn} look at`),
    chip('s-fail', `× ${c.fail} failed`),
    chip('s-na', `· ${c.na} calculated`),
    chip('', `${c.signed} of ${c.total} signed off`),
    chip('', `${c.questions} open question${c.questions === 1 ? '' : 's'}`),
    chip('', `${c.points} review point${c.points === 1 ? '' : 's'}`),
  );
}
