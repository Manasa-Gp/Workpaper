// views/filing.js — the Filing panel: what happened after the client signed.
//
// Called by: views/picker.js (left column, among the return-level panels).
// Reads:     filing.js (timeline, status, rejections), all from the packet. Nothing here is saved.
// Calls back: on.select(key) to jump to a line a rejection concerns.

import { h } from '../dom.js';
import { day, dayTime } from '../format.js';
import { filingStatus, filingTimeline, rejections } from '../filing.js';
import { amendmentsOf, filedEvent } from '../events.js';
import { num } from '../format.js';

const DOT = { accepted: '✓', rejected: '×', not_transmitted: '!' };

export function filing(state, on) {
  const packet = state.index.packet;
  const status = filingStatus(packet);
  const items = filingTimeline(packet);
  const found = rejections(packet);

  const word = (s) => (s ? { accepted: `accepted ${day(s.date)}`, rejected: 'rejected', not_transmitted: 'held' }[s.status] ?? s.status : 'not filed');
  const headline = status.allAccepted ? 'Filed' : status.federal ? 'In progress' : 'Not filed';

  return h('details', { class: 'filing' },
    h('summary', {}, 'Filing ', h('span', { class: `pill ${status.allAccepted ? 'p-pass' : 'p-info'}` }, headline)),
    h('p', {}, `Federal: ${word(status.federal)}. California: ${word(status.california)}.`),
    status.extendedTo
      ? h('p', { class: 'muted' }, `Extended to ${day(`${status.extendedTo}T12:00:00`)}. ${status.onTime ? 'Filed within the extension.' : 'Not filed within the extension.'}`)
      : null,
    frozen(state, on),
    h('ol', { class: 'filing-list' }, items.map((item) => h('li', { class: `f-${item.status ?? item.kind}` },
      h('p', {}, h('span', { class: 'f-mark', 'aria-hidden': 'true' }, DOT[item.status] ?? '•'), ' ', h('strong', {}, item.title)),
      h('p', { class: 'muted' }, item.dateOnly ? day(item.at) : dayTime(item.at)),
      h('p', { class: 'muted' }, item.detail),
    ))),
    found.length ? h('h3', {}, 'Rejections') : null,
    found.map(({ error, resolvedBy, help }) => h('div', { class: 'rejection-item' },
      h('p', {}, h('strong', {}, error.code), resolvedBy ? ' · resolved' : ' · open'),
      h('p', { class: 'muted' }, help?.title ?? error.message),
      help
        ? h('p', {}, 'Lines it concerns: ', help.lines.map((key) => h('button', { type: 'button', class: 'linkish', onClick: () => on.select(key) }, key)))
        : null,
    )),
  );
}

/** "Frozen at filing" and the amendments layered on top of it. Empty until the Partner marks the return filed. */
function frozen(state, on) {
  const filed = filedEvent(state.events);
  if (!filed) return null;
  const amends = amendmentsOf(state.events);
  return h('div', { class: 'frozen' },
    h('h3', {}, 'Frozen at filing'),
    h('p', {}, `${filed.by.name} (${filed.by.role}) marked the return filed on ${dayTime(filed.at)}. ${Object.keys(filed.snapshot).length} numbers are kept exactly as filed.`),
    h('p', { class: 'muted' }, `Fingerprint ${filed.fingerprint}`),
    h('h3', {}, amends.length ? `Amendments on top (${amends.length})` : 'Amendments on top'),
    amends.length
      ? amends.map((e) => h('div', { class: 'amend-item' },
        h('p', {}, h('button', { type: 'button', class: 'linkish', onClick: () => on.select(e.claim) }, e.claim), `  ${num(e.from)} → ${num(e.to)}`),
        h('p', { class: 'muted' }, `${e.text} · ${e.by.name} · ${dayTime(e.at)}`),
      ))
      : h('p', { class: 'muted' }, 'None. Any change from now on is added here and the filed numbers stay as they are.'),
  );
}
