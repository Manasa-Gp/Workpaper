// views/record.js — draws a record (an object from the packet) as labelled lines instead of raw JSON.
//
// Called by: views/source.js. Pure drawing: pass it already-masked data when it should be hidden.

import { h } from '../dom.js';

// Words that are not plain "capitalise the first letter" (abbreviations read wrongly as "Ssn").
const NAMES = { id: 'ID', ssn: 'SSN', ip_pin: 'IP PIN', ero_pin: 'ERO PIN', ptin: 'PTIN', ptins: 'PTINs', ein: 'EIN', tin: 'TIN', dob: 'Date of birth' };
const label = (key) => NAMES[String(key).toLowerCase()] ?? String(key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const plain = (v) => v === null || v === undefined || typeof v !== 'object';

function node(value) {
  if (value === null || value === undefined) return h('span', { class: 'muted' }, '—');
  if (Array.isArray(value)) {
    if (value.every(plain)) return h('span', {}, value.map((v) => (v === null ? '—' : String(v))).join(', ') || '—');
    return h('ol', { class: 'record-list' }, value.map((v) => h('li', {}, node(v))));
  }
  if (typeof value === 'object') {
    return h('dl', { class: 'record' }, Object.entries(value).flatMap(([k, v]) => [h('dt', {}, label(k)), h('dd', {}, node(v))]));
  }
  return h('span', {}, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value));
}

export const recordView = (value) => node(value);
