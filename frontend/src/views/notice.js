// views/notice.js — the Notices panel: agency letters, and a one-page answer built from each number's trail.
//
// Called by: views/picker.js (left column). Shown to staff only; the client sees "Your copy" instead.
// Reads:     notices.js. Nothing here is saved.
// Calls back: on.select(key) to jump to a line.

import { h } from '../dom.js';
import { dueDay, day, num } from '../format.js';
import { noticeAnswer, noticesOf } from '../notices.js';

export function notices(state, on) {
  if (state.role === 'client') return null;
  const list = noticesOf(state.index.packet);
  if (!list.length) return null;
  return h('details', { class: 'notices' },
    h('summary', {}, `Notices (${list.length})`),
    list.map((n) => notice(state, on, n)),
  );
}

function notice(state, on, n) {
  const answer = noticeAnswer(state.index, state.events, n, state.serverChecks?.signoffs);
  const open = Boolean(n.items_under_examination?.length);
  return h('div', { class: 'notice-item' },
    h('p', {}, h('strong', {}, `${n.agency} ${n.type}`), ` · tax year ${n.tax_year}`),
    h('p', { class: 'muted' }, `Dated ${dueDay(n.dated)}${n.response_due ? ` · answer due ${dueDay(n.response_due)}` : ''}`),
    n.summary ? h('p', { class: 'muted' }, n.summary) : null,
    n.status ? h('p', { class: 'muted' }, n.status) : null,
    open ? responseBlock(answer, on) : null,
  );
}

function responseBlock(answer, on) {
  const box = h('textarea', { class: 'notice-text', readonly: true, hidden: true, rows: 8, 'aria-label': 'Response record as text' }, answer.text);
  const copy = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const fallback = () => { box.hidden = false; box.select(); copy.textContent = 'Select and copy the text below'; };
      try { navigator.clipboard.writeText(answer.text).then(() => { copy.textContent = 'Copied'; }, fallback); } catch { fallback(); }
    },
  }, 'Copy the response record');
  return h('div', { class: 'notice-answer' },
    h('h3', {}, 'Response record'),
    answer.items.map((item) => h('div', { class: 'notice-q' },
      h('p', {}, item.text),
      item.records.length ? item.records.map((r) => record(r, on)) : h('p', { class: 'muted' }, 'No line is linked to this question yet.'),
    )),
    copy, box,
  );
}

function record(r, on) {
  return h('div', { class: 'notice-line' },
    h('p', {}, h('button', { type: 'button', class: 'linkish', onClick: () => on.select(r.key) }, r.key), ` ${r.label}: `, h('strong', {}, num(r.value))),
    h('p', { class: 'muted' }, `Rule ${r.rule}. ${r.signedOffBy ? `Signed off by ${r.signedOffBy}.` : 'Not signed off.'}`),
    r.sources.length ? h('ul', { class: 'notice-sources' }, r.sources.map((s) => h('li', {}, s))) : null,
    r.notes.map((n) => h('p', { class: 'muted' }, `Note: ${n.text} (${n.by}, ${day(n.at)})`)),
    r.parts.map((p) => record(p, on)),
  );
}
