// views/picker.js — the left column: every number on the return, grouped by form.
//
// Called by: main.js render().
// Reads:     state.statusByKey (computed once in main.js from checks.js), state.filter, state.onlyAttention.
// Calls back: on.select(key) when a number is clicked, on.filter(text), on.attention(bool).
//
// Each row shows a status glyph so what needs attention is visible without opening anything:
//   ✓ checks pass    ! something to look at    × a check failed    · calculated, no source documents

import { h, clear } from '../dom.js';
import { num } from '../format.js';
import { effectiveValue, signoffState, openQuestionCount, openReviewPoints } from '../events.js';
import { inbox } from './inbox.js';
import { approval } from './approval.js';
import { activity } from './activity.js';

const GLYPH = { pass: '✓', warn: '!', fail: '×', na: '·' };
const WORDS = { pass: 'checks pass', warn: 'look at this', fail: 'a check failed', na: 'calculated, no source documents' };

export function renderPicker(el, state, on) {
  const lines = state.index.current.lines.filter((l) => l.value !== null && l.value !== undefined);
  const needle = state.filter.trim().toLowerCase();

  const shown = lines.filter((line) => {
    if (needle && !(`${line.key} ${line.label}`.toLowerCase().includes(needle))) return false;
    if (state.onlyAttention) {
      const s = state.statusByKey.get(line.key);
      return s === 'warn' || s === 'fail';
    }
    return true;
  });

  const groups = new Map();
  for (const line of shown) {
    const group = `${line.jurisdiction === 'california' ? 'California · ' : ''}${line.form}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(line);
  }

  const needAttention = lines.filter((l) => ['warn', 'fail'].includes(state.statusByKey.get(l.key))).length;

  clear(el);
  el.append(
    inbox(state, on),
    approval(state, on),
    activity(state, on),
    h('div', { class: 'picker-head' },
      h('input', {
        id: 'filter', type: 'search', placeholder: 'Find a number, e.g. wages or F1040.1a', value: state.filter,
        'aria-label': 'Find a number', onInput: (e) => on.filter(e.target.value),
      }),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', id: 'only-attention', checked: state.onlyAttention, onChange: (e) => on.attention(e.target.checked) }),
        `Needs attention (${needAttention})`,
      ),
    ),
    h('div', { class: 'picker-list' },
      groups.size === 0 ? h('p', { class: 'empty' }, 'No numbers match.') : null,
      [...groups].map(([group, items]) =>
        h('section', { class: 'group' },
          h('h3', {}, group),
          items.map((line) => row(line, state, on)),
        ),
      ),
    ),
  );
}

function row(line, state, on) {
  const status = state.statusByKey.get(line.key) ?? 'na';
  const value = effectiveValue(line, state.events);
  const adjusted = value !== line.value;
  const so = signoffState(line, state.events).state;
  const open = openQuestionCount(state.events, line.key);
  const points = openReviewPoints(state.events, line.key).length;
  return h(
    'button',
    {
      type: 'button',
      class: `row${line.key === state.key ? ' is-selected' : ''}`,
      'aria-current': line.key === state.key ? 'true' : null,
      onClick: () => on.select(line.key),
    },
    h('span', { class: `glyph s-${status}`, title: WORDS[status], 'aria-label': WORDS[status] }, GLYPH[status]),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-label' }, line.label),
      h('span', { class: 'row-key' }, line.key, adjusted ? ' · adjusted' : '', so === 'signed' ? ' · signed off' : so === 'reopened' ? ' · reopened' : '', open ? ` · ${open} open question${open === 1 ? '' : 's'}` : '', points ? ` · ${points} review point${points === 1 ? '' : 's'}` : ''),
    ),
    h('span', { class: 'row-value' }, typeof value === 'number' ? num(value) : String(value)),
  );
}
