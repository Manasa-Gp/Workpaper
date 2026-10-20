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
import { actor, can, WHY_NOT } from '../roles.js';
import { lastBatch } from '../batch.js';
import { newByKey } from '../lastvisit.js';
import { signoffFor } from '../serverchecks.js';
import { effectiveValue, openQuestionCount, openReviewPoints, filedEvent, filedValue } from '../events.js';

const GLYPH = { pass: '✓', warn: '!', fail: '×', na: '·' };
const WORDS = { pass: 'checks pass', warn: 'look at this', fail: 'a check failed', na: 'calculated, no source documents' };

export function renderPicker(el, state, on, batchStrip = null) {
  const fresh = newByKey(state.events, state.since, actor(state.index.packet, state.role).name);
  const lines = state.index.current.lines.filter((l) => l.value !== null && l.value !== undefined);
  const needle = state.filter.trim().toLowerCase();

  const shown = lines.filter((line) => {
    if (needle && !(`${line.key} ${line.label}`.toLowerCase().includes(needle))) return false;
    if (state.onlyNew && !fresh.has(line.key)) return false;
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

  // The batch bar sits in a full-width strip under the status counts, not inside the column.
  const bar = batchBar(state, on, shown);
  if (batchStrip) { clear(batchStrip); batchStrip.hidden = !bar; if (bar) batchStrip.append(bar); }

  clear(el);
  el.append(
    h('div', { class: 'picker-head' },
      h('input', {
        id: 'filter', type: 'search', placeholder: 'Find a number, e.g. wages or F1040.1a', value: state.filter,
        'aria-label': 'Find a number', onInput: (e) => on.filter(e.target.value),
      }),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', id: 'only-attention', checked: state.onlyAttention, onChange: (e) => on.attention(e.target.checked) }),
        `Needs attention (${needAttention})`,
      ),
      can(state.role, 'note') || can(state.role, 'undo') ? h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', id: 'select-mode', checked: state.selectMode, onChange: (e) => on.selectMode(e.target.checked) }),
        'Select several',
      ) : null,
      fresh.size || state.onlyNew ? h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', id: 'only-new', checked: state.onlyNew, onChange: (e) => on.onlyNew(e.target.checked) }),
        `New since last visit (${fresh.size})`,
        h('button', { type: 'button', class: 'linkish', onClick: () => on.seen() }, 'Mark all as seen'),
      ) : null,
    ),
    h('div', { class: 'picker-list' },
      groups.size === 0 ? h('p', { class: 'empty' }, 'No numbers match.') : null,
      [...groups].map(([group, items]) =>
        h('section', { class: 'group' },
          h('h3', {}, group),
          items.map((line) => row(line, state, on, fresh.get(line.key) ?? 0)),
        ),
      ),
    ),
  );
}

function row(line, state, on, fresh = 0) {
  const status = state.statusByKey.get(line.key) ?? 'na';
  const value = effectiveValue(line, state.events);
  const adjusted = value !== line.value;
  const so = signoffFor(state, line.key).state;
  const open = openQuestionCount(state.events, line.key);
  const points = openReviewPoints(state.events, line.key).length;
  return h(
    'button',
    {
      type: 'button',
      class: `row${line.key === state.key ? ' is-selected' : ''}`,
      'aria-current': line.key === state.key ? 'true' : null,
      onClick: () => (state.selectMode ? on.toggleSel(line.key) : on.select(line.key)),
    },
    state.selectMode ? h('span', { class: 'sel-box', 'aria-hidden': 'true' }, state.selected.has(line.key) ? '☑' : '☐') : null,
    h('span', { class: `glyph s-${status}`, title: WORDS[status], 'aria-label': WORDS[status] }, GLYPH[status]),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-label' }, line.label),
      h('span', { class: 'row-key' }, line.key, fresh ? ` · ${fresh} new` : '', state.tryIt.has(line.key) ? ' · trying' : '', adjusted && !filedEvent(state.events) ? ' · adjusted' : '', filedEvent(state.events) && value !== filedValue(state.events, line.key) && filedValue(state.events, line.key) !== null ? ' · amended' : '', so === 'signed' ? ' · signed off' : so === 'reopened' ? ' · reopened' : '', open ? ` · ${open} open question${open === 1 ? '' : 's'}` : '', points ? ` · ${points} review point${points === 1 ? '' : 's'}` : ''),
    ),
    h('span', { class: 'row-value' }, typeof value === 'number' ? num(value) : String(value)),
  );
}

/** Ch4: the bar that appears in "Select several" mode. */
function batchBar(state, on, shown) {
  if (!state.selectMode) return null;
  const who = actor(state.index.packet, state.role);
  const last = lastBatch(state.events);
  const gate = (action, btn) => { if (!can(state.role, action)) { btn.setAttribute('disabled', ''); btn.setAttribute('title', WHY_NOT[action]); } return btn; };
  const text = h('input', { type: 'text', id: 'batch-text', value: state.batchText, placeholder: 'Note to add to every selected line', 'aria-label': 'Batch note', onInput: (e) => on.batchText(e.target.value) });
  const note = gate('note', h('button', { type: 'button', class: 'btn', onClick: () => { const t = state.batchText.trim(); if (t) on.batch('note', t); } }, 'Add note to all'));
  const verify = gate('verify', h('button', { type: 'button', class: 'btn', onClick: () => on.batch('verify') }, 'Mark verified'));
  const undo = gate('undo', h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => on.undoBatch() }, 'Undo last batch'));
  if (!last) undo.setAttribute('disabled', '');
  return h('div', { class: 'batch-bar' },
    h('p', {}, h('strong', {}, `${state.selected.size} selected`), ` · acting as ${who.name}`,
      h('button', { type: 'button', class: 'linkish', onClick: () => on.selectMany(shown.map((l) => l.key)) }, `Select all shown (${shown.length})`),
      h('button', { type: 'button', class: 'linkish', onClick: () => on.selectMany([]) }, 'Clear')),
    text,
    h('div', { class: 'btns' }, note, can(state.role, 'verify') ? verify : null, undo, last ? h('span', { class: 'muted' }, `Last batch: ${last.count} changes`) : null),
    state.batchMsg ? h('p', { class: 'muted' }, state.batchMsg) : null);
}
