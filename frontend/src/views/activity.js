// views/activity.js — everything everyone did, in the order the server saved it, newest first.
//
// Called by: views/picker.js (left column, under the return approval).
// Reads:     state.events (already limited by the server to what this role may see).
// Calls back: on.select(key) to jump to the number an item is about.
//
// With several people working at once this is the one place to see the combined story.

import { h } from '../dom.js';
import { EVENT_LABEL, RETURN_KEY } from '../events.js';
import { dayTime } from '../format.js';

const SHOWN = 30;

export function activity(state, on) {
  const all = [...state.events].reverse();
  const items = all.slice(0, SHOWN);
  return h('details', { class: 'activity' },
    h('summary', {}, `Activity (${all.length})`),
    all.length === 0 ? h('p', { class: 'muted' }, 'Nothing has happened yet.') : null,
    h('ul', { class: 'inbox-list' }, items.map((e) => h('li', {},
      e.private
        ? h('p', { class: 'muted' }, `Private question on ${e.claim} · ${dayTime(e.at)}`)
        : [
            h('p', {}, h('strong', {}, EVENT_LABEL[e.type] ?? e.type), ' · ', e.by.name, ` (${e.by.role})`),
            e.claim === RETURN_KEY
              ? h('p', { class: 'muted' }, `Whole return · ${dayTime(e.at)}`)
              : h('p', { class: 'muted' }, h('button', { type: 'button', class: 'linkish', onClick: () => on.select(e.claim) }, e.claim), ` · ${dayTime(e.at)}`),
          ],
    ))),
    all.length > SHOWN ? h('p', { class: 'muted' }, `Showing the latest ${SHOWN}.`) : null,
  );
}
