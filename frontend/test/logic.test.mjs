// test/logic.test.mjs — run with: node test/logic.test.mjs
// Checks the non-visual logic against the real packet: tracing, the checks, sign-off reopening.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildIndex, docLanding } from '../src/packetIndex.js';
import { traceClaim } from '../src/trace.js';
import { printedMatch, duplicateDoc, duplicatePage, claimChecks, worst } from '../src/checks.js';
import { can } from '../src/roles.js';
import { questionsFor, openQuestionCount, effectiveValue, signoffState, taxEffect, signoffBlocker, openReviewPoints, reviewPointsFor, assignmentsFor, inboxFor, returnFingerprint, approvalState, signersOf, allOpenReviewPoints, EVENT_LABEL } from '../src/events.js';

const packet = JSON.parse(readFileSync(new URL('../../backend/data/packet.json', import.meta.url)));
const index = buildIndex(packet);
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

test('the Halvorsen W-2 is flagged as a probable duplicate (D09 vs D10)', () => {
  assert.equal(duplicateDoc(index, 'D09').status, 'warn');
  assert.equal(duplicateDoc(index, 'D10').status, 'warn');
});

test('the corrected Meridian 1099 supersedes the original (D30 vs D31)', () => {
  assert.equal(duplicateDoc(index, 'D31').status, 'pass');
  assert.match(duplicateDoc(index, 'D31').detail, /superseded/);
});

test('mileage log page 3 is a second scan of page 2', () => {
  assert.equal(duplicatePage(index, 'D23', 3).status, 'warn');
  assert.equal(duplicatePage(index, 'D23', 1).status, 'pass');
});

test('SchC.44a (business miles) is flagged because of the duplicate page', () => {
  const checks = claimChecks(index, traceClaim(index, 'SchC.44a'));
  assert.ok(checks.some((c) => c.id === 'duppage' && c.status === 'warn'));
});

test('the childcare provider ID misread is caught (ev-1045)', () => {
  assert.equal(printedMatch(index, index.values.get('ev-1045')).status, 'fail');
});

test('a blank RSU basis recorded as 0 is flagged (ev-0498)', () => {
  assert.equal(printedMatch(index, index.values.get('ev-0498')).status, 'warn');
});

test('the W-2 box 1 reads match the printed text', () => {
  assert.equal(printedMatch(index, index.values.get('ev-0016')).status, 'pass');
});

test('a document with no landing explains why (D10)', () => {
  const landing = docLanding(index, 'D10');
  assert.equal(landing.keys.length, 0);
  assert.ok(landing.note.length > 0);
});

test('sign-off reopens when the value changes', () => {
  const line = index.current.byKey.get('F1040.1a');
  const events = [{ claim: 'F1040.1a', type: 'signoff', valueAtSignoff: 212400, by: {}, at: 'x' }];
  assert.equal(signoffState(line, events).state, 'signed');
  events.push({ claim: 'F1040.1a', type: 'adjust', from: 212400, to: 200000 });
  assert.equal(effectiveValue(line, events), 200000);
  assert.equal(signoffState(line, events).state, 'reopened');
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

test('sign-off rule: warnings and fails need a note; flagged checks need verification', () => {
  const by = { name: 'T', role: 'Reviewer' };
  // F1040.1a: only the "possible copy" flag, which needs Mark verified (no warning, no fail)
  const c1 = claimChecks(index, traceClaim(index, 'F1040.1a'));
  assert.match(signoffBlocker(c1, [], 'F1040.1a'), /Mark verified/);
  const verified = [{ claim: 'F1040.1a', type: 'verify', check: 'dupdoc:D09:D10', by }];
  assert.equal(signoffBlocker(c1, verified, 'F1040.1a'), null);
  // SchC.44a: duplicate-page warning needs a note
  const c2 = claimChecks(index, traceClaim(index, 'SchC.44a'));
  assert.match(signoffBlocker(c2, [], 'SchC.44a'), /warning/);
  assert.match(signoffBlocker(c2, [{ claim: 'SchC.44a', type: 'note', by, text: 'hey' }], 'SchC.44a'), /at least/);
  assert.equal(signoffBlocker(c2, [{ claim: 'SchC.44a', type: 'note', by, text: 'Pages 2 and 3 are one sheet scanned twice.' }], 'SchC.44a'), null);
});

test('an adjusted value that no longer matches its sources gets its own warning, and the original row stays', () => {
  const trace = traceClaim(index, 'F1040.1a');
  const plain = claimChecks(index, trace, 212400);
  assert.ok(!plain.some((c) => c.id === 'tieAdjusted'));
  const adjusted = claimChecks(index, trace, 200000);
  assert.equal(adjusted.find((c) => c.id === 'tie').status, 'pass'); // original result still visible
  const row = adjusted.find((c) => c.id === 'tieAdjusted');
  assert.equal(row.status, 'warn');
  assert.match(row.detail, /no longer matches its sources/);
  assert.match(signoffBlocker(adjusted, [{ claim: 'F1040.1a', type: 'verify', check: 'dupdoc:D09:D10', by: { name: 'T', role: 'R' } }], 'F1040.1a'), /warning/);
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

test('an open review point blocks sign-off until it is cleared', () => {
  const b = { id: 'b1', claim: 'F1040.1a', type: 'block', text: 'Source missing' };
  assert.equal(openReviewPoints([b], 'F1040.1a').length, 1);
  assert.match(signoffBlocker([], [b], 'F1040.1a'), /review point is still open/);
  const c = { id: 'c1', claim: 'F1040.1a', type: 'clear', clears: 'b1' };
  assert.equal(openReviewPoints([b, c], 'F1040.1a').length, 0);
  assert.equal(signoffBlocker([], [b, c], 'F1040.1a'), null);
  assert.equal(reviewPointsFor([b, c], 'F1040.1a')[0].c.id, 'c1');
  assert.equal(signoffBlocker([], [b], 'F1040.1b'), null); // another line is not affected
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

test('the return fingerprint changes when a number changes, and approval goes out of date', () => {
  const lines = index.current.lines;
  const f0 = returnFingerprint(lines, []);
  assert.equal(returnFingerprint(lines, []), f0, 'same numbers, same fingerprint');
  const key = lines.find((l) => typeof l.value === 'number').key;
  const adjust = { id: 'a1', claim: key, type: 'adjust', to: 123456789, by: { name: 'P', role: 'Preparer' } };
  const f1 = returnFingerprint(lines, [adjust]);
  assert.notEqual(f1, f0);
  const signers = signersOf(packet);
  assert.deepEqual(signers, ['Ngozi Okafor', 'Erik Lindqvist']); // taxpayer and spouse, not the dependent
  const present = { id: 'p1', type: 'present', claim: 'RETURN', fingerprint: f0, by: { name: 'D', role: 'Reviewer' } };
  const ok = (name) => ({ id: `s-${name}`, type: 'approve', claim: 'RETURN', presents: 'p1', signer: name, fingerprint: f0 });
  assert.equal(approvalState([], f0, signers).state, 'none');
  assert.equal(approvalState([present], f0, signers).state, 'presented');
  assert.equal(approvalState([present, ok(signers[0])], f0, signers).state, 'partly');
  assert.deepEqual(approvalState([present, ok(signers[0])], f0, signers).missing, [signers[1]]);
  assert.equal(approvalState([present, ok(signers[0]), ok(signers[1])], f0, signers).state, 'approved');
  assert.equal(approvalState([present, ok(signers[0]), ok(signers[1]), adjust], f1, signers).state, 'stale'); // a number changed after signing
  const newer = { ...present, id: 'p2', fingerprint: f1 };
  assert.equal(approvalState([present, ok(signers[0]), newer], f1, signers).state, 'presented'); // old signatures do not carry over
  assert.equal(allOpenReviewPoints([{ id: 'b', type: 'block' }, { id: 'c', type: 'clear', clears: 'b' }, { id: 'b2', type: 'block' }]).length, 1);
  for (const type of ['present', 'approve']) assert.ok(EVENT_LABEL[type]);
  assert.equal(can('client', 'approve'), true);
  assert.equal(can('preparer', 'present'), false);
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
  tally[worst(claimChecks(index, traceClaim(index, line.key)))] += 1;
}
console.log(`\n${passed} tests passed. Claims with evidence by worst check:`, tally);
