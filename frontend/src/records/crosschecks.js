// records/crosschecks.js — every cross-check in one table (the same ones that show on each claim).

import { link } from './core.js';
import { crossFor } from '../serverchecks.js';

const WORD = { pass: 'Agree', fail: 'Do not agree' };

export function crossCheckList(state) {
  const list = crossFor(state);
  const failing = list.filter((c) => c.status === 'fail').length;
  return {
    intro: `Figures the client gave, set against what an agency or a document says. ${failing} of ${list.length} do not agree. Each failing row is also a check on the line it is about.`,
    tables: [{
      heading: 'Cross-checks',
      columns: [{ label: 'Check' }, { label: 'Result' }, { label: 'Return says' }, { label: 'Other source says' }, { label: 'Line' }, { label: 'What it means' }],
      rows: list.map((c) => [c.label, WORD[c.status], c.said, c.other, c.lines[0] ? link(c.lines[0]) : null, c.detail]),
    }],
  };
}
