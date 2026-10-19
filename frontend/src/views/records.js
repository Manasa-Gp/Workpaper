// views/records.js — the Records panel (a list in the left column) and the record page (in the middle column).
//
// Called by: views/picker.js (the panel) and main.js render() (the page, shown instead of a line while one is open).
// Reads:     records/index.js. Nothing here is saved.
// Calls back: on.record(id) to open or close a record, on.select(key) to open a line.

import { h, clear } from '../dom.js';
import { num } from '../format.js';
import { RECORDS, recordById } from '../records/index.js';

export function recordsPanel(state, on) {
  if (state.role === 'client') return null;
  const groups = [...new Set(RECORDS.map((r) => r.group))];
  return h('details', { class: 'records-panel', open: state.recordsOpen, onToggle: (e) => on.recordsOpen(e.target.open) },
    h('summary', {}, `Records (${RECORDS.length})`),
    groups.map((g) => h('div', {},
      h('h3', {}, g),
      h('ul', { class: 'records-list' }, RECORDS.filter((r) => r.group === g).map((r) => h('li', {},
        h('button', { type: 'button', class: `linkish${state.record === r.id ? ' is-open' : ''}`, onClick: () => on.record(r.id) }, r.title),
      ))),
    )),
  );
}

export function renderRecord(el, state, on) {
  clear(el);
  const def = recordById(state.record);
  if (!def) return;
  let built;
  try { built = def.build(state); } catch (err) { built = { intro: `This record could not be built: ${err.message}`, tables: [] }; }
  el.append(
    h('header', { class: 'claim-head' },
      h('p', { class: 'eyebrow' }, `Record · ${def.group}`),
      h('h1', {}, def.title),
      built.intro ? h('p', { class: 'muted' }, built.intro) : null,
      h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => on.record(null) }, 'Close and go back to the numbers'),
    ),
    ...built.tables.map((t) => table(t, state, on)),
  );
}

function cell(value, column, on) {
  if (value && typeof value === 'object' && value.key) return h('td', {}, h('button', { type: 'button', class: 'linkish', onClick: () => on.select(value.key) }, value.text));
  if (value === null || value === undefined || value === '') return h('td', { class: 'muted' }, '—');
  if (typeof value === 'number') return h('td', { class: 'rec-num' }, num(value));
  return h('td', { class: column?.num ? 'rec-num' : '' }, String(value));
}

const FOLD_OVER = 25; // a table longer than this keeps only its problem rows open

/** The worst check status of the line a row is about (the server's answer), or null if the row is not about a line. */
function rowStatus(row, state) {
  const key = row[0] && typeof row[0] === 'object' ? row[0].key : null;
  return key ? state.serverChecks?.claims[key]?.worst ?? null : null;
}

function table(t, state, on) {
  const problem = (row) => ['fail', 'warn'].includes(rowStatus(row, state));
  const flagged = t.rows.filter(problem);
  const rest = t.rows.filter((r) => !problem(r));
  const head = h('thead', {}, h('tr', {}, t.columns.map((c) => h('th', { class: c.num ? 'rec-num' : '' }, c.label))));
  const body = (rows) => h('tbody', {}, rows.map((row) => {
    const status = rowStatus(row, state);
    return h('tr', { class: problem(row) ? `rec-flag rec-${status}` : '' }, row.map((v, i) => cell(v, t.columns[i], on)));
  }));
  const grid = (rows) => h('div', { class: 'rec-scroll' }, h('table', { class: 'rec' }, head.cloneNode(true), body(rows)));
  const fold = t.rows.length > FOLD_OVER;
  let content;
  if (!t.rows.length) content = h('p', { class: 'muted' }, t.note ?? 'Nothing to show.');
  else if (!fold) content = grid([...flagged, ...rest]);
  else content = [
    flagged.length ? grid(flagged) : h('p', { class: 'muted' }, 'No row here has a warning or a failed check.'),
    rest.length ? h('details', { class: 'rec-fold' }, h('summary', {}, flagged.length ? `Show the other ${rest.length} rows` : `Show all ${rest.length} rows`), grid(rest)) : null,
  ].filter(Boolean);
  return h('section', { class: 'block record-block' },
    h('h2', {}, t.heading, ` (${t.rows.length})`, flagged.length ? h('span', { class: 'rec-count' }, ` · ${flagged.length} need a look`) : null),
    content,
    t.rows.length && t.note ? h('p', { class: 'muted' }, t.note) : null,
  );
}
