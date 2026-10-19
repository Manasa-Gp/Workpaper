// test/logic.test.mjs — run with: node test/logic.test.mjs
// Checks the non-visual logic against the real packet: tracing, the checks, sign-off reopening.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildIndex, docLanding } from '../src/packetIndex.js';
import { traceClaim } from '../src/trace.js';
import { execFileSync } from 'node:child_process';
import { can, canSeeSensitive } from '../src/roles.js';
import { filingTimeline, filingStatus, rejections, rejectionsForLine } from '../src/filing.js';
import { questionsFor, openQuestionCount, effectiveValue, taxEffect, openReviewPoints, reviewPointsFor, assignmentsFor, inboxFor, allOpenReviewPoints, EVENT_LABEL, filedEvent, snapshotOf, amendmentsOf, filedValue } from '../src/events.js';

const packet = JSON.parse(readFileSync(new URL('../../backend/data/packet.json', import.meta.url)));
const index = buildIndex(packet);
// The checks are worked out by the server (backend/checks.py). The tests ask it for its answers.
const server = JSON.parse(execFileSync('python3', [new URL('../../backend/dump_checks.py', import.meta.url).pathname], { maxBuffer: 1e9 }));
const claimChecks = (_index, trace) => server.claims[trace.line.key].checks;
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('ok  ', name); };

test('current version is v3', () => assert.equal(index.current.version, 'v3'));

test('F1040.1a traces to two W-2 box 1 values that add up', () => {
  const trace = traceClaim(index, 'F1040.1a');
  assert.deepEqual(trace.sources.map((s) => s.ref), ['ev-0016', 'ev-0035']);
  const tie = claimChecks(index, trace).find((c) => c.id === 'tie');
  assert.equal(tie.status, 'pass');
  assert.deepEqual(trace.feeds.map((l) => l.key), ['F1040.1z']);
});

test('SchC.44a (business miles) is flagged because of the duplicate page', () => {
  const checks = claimChecks(index, traceClaim(index, 'SchC.44a'));
  assert.ok(checks.some((c) => c.id === 'duppage' && c.status === 'warn'));
});

test('a document with no landing explains why (D10)', () => {
  const landing = docLanding(index, 'D10');
  assert.equal(landing.keys.length, 0);
  assert.ok(landing.note.length > 0);
});

test('tax effect uses the packet rate per dollar', () => {
  const effect = taxEffect(index.current, 'F1040.1a', -1000);
  assert.equal(effect.federal, -1000 * index.current.tax_effect_rates.wages.federal_per_dollar);
});

test('the D09/D10 duplicate on F1040.1a and 25a passes but asks a person to verify', () => {
  for (const key of ['F1040.1a', 'F1040.25a']) {
    const checks = claimChecks(index, traceClaim(index, key));
    const note = checks.find((c) => c.verify);
    assert.equal(note.status, 'pass');
    assert.equal(note.verifyKey, 'dupdoc:D09:D10');
    assert.match(note.detail, /not a source of this line/);
    assert.ok(!checks.some((c) => c.id === 'dupdoc' && c.status === 'warn'));
  }
});

test('SchC.44a shows the duplicate-page warning once, naming both pages and both sources', () => {
  const rows = claimChecks(index, traceClaim(index, 'SchC.44a')).filter((c) => c.id === 'duppage' && c.status === 'warn');
  assert.equal(rows.length, 1);
  assert.match(rows[0].detail, /Pages 2 and 3 of D23/);
  assert.deepEqual(rows[0].refs, ['ev-0315', 'ev-0404']);
});

test('related: last years value for the same line, and lines sharing evidence', () => {
  const t = traceClaim(index, 'F1040.1a');
  assert.equal(t.lastYear.value, 156039);
  const withShared = index.current.lines.find((l) => traceClaim(index, l.key).sharedWith.length);
  if (withShared) {
    const hit = traceClaim(index, withShared.key).sharedWith[0];
    // sharing is mutual: the other line must list this one back
    assert.ok(traceClaim(index, hit.line.key).sharedWith.some((x) => x.line.key === withShared.key));
  }
  assert.equal(traceClaim(index, 'SchC.44a').lastYear === null || typeof traceClaim(index, 'SchC.44a').lastYear.value === 'number', true);
});

test('evidence: staff can add it, the client and administrator cannot', () => {
  for (const r of ['preparer', 'reviewer', 'partner']) assert.equal(can(r, 'evidence'), true);
  for (const r of ['client', 'admin']) assert.equal(can(r, 'evidence'), false);
});

test('questions: an answer attaches to its question, and open ones are counted', () => {
  const q = { id: 'q1', type: 'question', claim: 'F1040.1a', to: 'Client', text: 'Which W-2 is this?' };
  const a = { id: 'a1', type: 'answer', claim: 'F1040.1a', answers: 'q1', text: 'The Halvorsen one.' };
  assert.equal(openQuestionCount([q], 'F1040.1a'), 1);
  assert.equal(openQuestionCount([q, a], 'F1040.1a'), 0);
  assert.equal(questionsFor([q, a], 'F1040.1a')[0].a.text, 'The Halvorsen one.');
  assert.equal(can('client', 'answer'), true);
  assert.equal(can('client', 'ask'), false);
});

test('the inbox lists what is waiting on a role, overdue first', () => {
  const by = { name: 'X', role: 'Reviewer' };
  const events = [
    { id: 'q1', type: 'question', claim: 'A', to: 'Preparer', text: 'where is it?', by, at: '2026-10-01T00:00:00Z' },
    { id: 't1', type: 'assign', claim: 'B', to: 'Preparer', due: '2026-10-20', text: 'later', by, at: '2026-10-02T00:00:00Z' },
    { id: 't2', type: 'assign', claim: 'C', to: 'Preparer', due: '2026-10-10', text: 'late', by, at: '2026-10-03T00:00:00Z' },
    { id: 't3', type: 'assign', claim: 'D', to: 'Preparer', due: '2026-10-05', text: 'finished', by, at: '2026-10-04T00:00:00Z' },
    { id: 'd3', type: 'done', claim: 'D', closes: 't3', by, at: '2026-10-06T00:00:00Z' },
    { id: 'b1', type: 'block', claim: 'E', text: 'fix', by, at: '2026-10-07T00:00:00Z' },
    { id: 'q2', type: 'question', claim: 'F', private: true },
  ];
  const mine = inboxFor(events, 'Preparer', '2026-10-18');
  assert.deepEqual(mine.map((i) => i.text), ['late', 'later', 'where is it?', 'fix']);
  assert.equal(mine[0].overdue, true);
  assert.equal(mine[1].overdue, false);
  assert.deepEqual(inboxFor(events, 'Reviewer', '2026-10-18'), []); // review points are for the preparer to deal with
  assert.equal(assignmentsFor(events, 'D')[0].d.id, 'd3');
});

test('filing: the timeline merges the firm and the agencies, in order, without leaking the PINs', () => {
  const items = filingTimeline(packet);
  const titles = items.map((i) => i.title);
  assert.deepEqual(items.map((i) => i.at), [...items.map((i) => i.at)].sort(), 'oldest first');
  for (const expected of ['Extension filed with payment', 'Client signed Form 8879 and FTB 8879', 'Federal return rejected', 'California return held (not sent)', 'Federal return accepted', 'California return accepted', 'Federal balance paid', 'California refund issued']) {
    assert.ok(titles.includes(expected), `has: ${expected}`);
  }
  assert.ok(titles.indexOf('Federal return accepted') < titles.indexOf('IRS recorded the return as filed'), 'accepted comes before the IRS records it');
  assert.ok(!JSON.stringify(items).match(/41207|88310/), 'the signers PINs are not shown');
  assert.match(items.find((i) => i.kind === 'payment').detail, /4,220/);
  assert.match(items.find((i) => i.kind === 'refund').detail, /8,256/);
  const status = filingStatus(packet);
  assert.equal(status.allAccepted, true);
  assert.equal(status.filedOn, '2026-07-14');
  assert.equal(status.extendedTo, '2026-10-15');
  assert.equal(status.onTime, true);
});

test('filing: the rejection is explained, resolved, and shown against the lines it concerns', () => {
  const found = rejections(packet, server.ssnMismatch);
  assert.equal(found.length, 1);
  assert.equal(found[0].error.code, 'R0000-504-02');
  assert.equal(found[0].resolvedBy.date.slice(0, 10), '2026-07-14');
  assert.equal(found[0].held.length, 1, 'the California return was held');
  const m = found[0].help.mismatch;
  assert.deepEqual([m.person, m.docId, m.swapped], ['Theo Lindqvist-Okafor', 'D71', true]);
  assert.notEqual(m.organizer, m.card);
  assert.equal(m.valueRef, 'ev-1080', 'the button opens the number on the card');
  assert.ok(index.values.has(m.valueRef));
  assert.equal(m.card, '•••-••-3390', 'the server sends it masked');
  assert.equal(m.organizer, '•••-••-3309');
  for (const key of ['F1040.19', 'F8812.4', 'F8812.6', 'F2441.2', 'F540NR.39']) assert.equal(rejectionsForLine(packet, key, server.ssnMismatch).length, 1, key);
  assert.equal(rejectionsForLine(packet, 'F1040.1a', server.ssnMismatch).length, 0, 'an unrelated line shows no rejection');
  for (const key of ['F1040.19', 'F8812.4', 'F8812.6', 'F2441.2', 'F540NR.39']) assert.ok(index.current.byKey.has(key), `${key} exists in the current return`);
});

test('masking: who may reveal sensitive numbers', () => {
  assert.equal(canSeeSensitive(packet, 'reviewer'), true);
  for (const role of ['preparer', 'reviewer', 'partner', 'admin']) assert.equal(canSeeSensitive(packet, role), true, `${role} is cleared in the packet`);
  assert.equal(canSeeSensitive(packet, 'preparer2'), false, 'Marcus Bell is a preparer the firm has not cleared');
  assert.equal(canSeeSensitive(packet, 'client'), false, 'the client is not staff, so has no clearance');
  // the answer comes from the packet, not from the role name: change the packet and the answer changes
  const changed = structuredClone(packet);
  changed.firm.staff.find((s) => s.id === 'st-01').sensitive_data_clearance = false;
  assert.equal(canSeeSensitive(changed, 'preparer'), false);
  assert.equal(packet.firm.staff.find((s) => s.id === 'st-04').name, 'Marcus Bell');
});

test('freeze at filing: the snapshot keeps the filed numbers; amendments sit on top', () => {
  const lines = index.current.lines;
  const key = lines.find((l) => typeof l.value === 'number').key;
  const fp = 'abc';
  const file = { id: 'f1', type: 'file', claim: 'RETURN', fingerprint: fp, snapshot: snapshotOf(lines, []), by: { name: 'H', role: 'Partner' } };
  assert.equal(filedEvent([]), undefined);
  assert.equal(filedEvent([file]).id, 'f1');
  assert.equal(filedValue([file], key), lines.find((l) => l.key === key).value);
  const line = lines.find((l) => l.key === key);
  const amend = { id: 'a1', type: 'amend', claim: key, from: line.value, to: 424242, by: { name: 'P', role: 'Preparer' } };
  assert.equal(effectiveValue(line, [file, amend]), 424242, 'the amendment is the number now');
  assert.equal(filedValue([file, amend], key), line.value, 'the filed number is untouched');
  assert.equal(amendmentsOf([file, amend]).length, 1);
  for (const type of ['file', 'amend']) assert.ok(EVENT_LABEL[type]);
  assert.equal(can('partner', 'file'), true);
  assert.equal(can('reviewer', 'file'), false);
  assert.equal(can('preparer', 'amend'), true);
  assert.equal(can('reviewer', 'amend'), false);
});

test('a private question stub is not counted and has no text', () => {
  const stub = { id: 'q2', type: 'question', claim: 'F1040.1a', private: true };
  assert.equal(openQuestionCount([stub], 'F1040.1a'), 0);
  assert.equal(questionsFor([stub], 'F1040.1a')[0].q.private, true);
});

test('nothing in frontend/src draws text with innerHTML or similar', () => {
  const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = new URL(`${name}`, dir);
      if (statSync(path).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (name.endsWith('.js')) files.push(path);
    }
  };
  walk(new URL('../src/', import.meta.url));
  assert.ok(files.length > 5, 'found the source files');
  for (const file of files) assert.ok(!banned.test(readFileSync(file, 'utf8')), `${file.pathname} must not use ${banned}`);
});

// Summary over every claim with evidence, so you can see what the checks find overall.
const tally = { fail: 0, warn: 0, pass: 0, na: 0 };
for (const line of index.current.lines) {
  if (!line.sources?.length) continue;
  tally[server.claims[line.key].worst] += 1;
}
console.log(`\n${passed} tests passed. Claims with evidence by worst check:`, tally);
