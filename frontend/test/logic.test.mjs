// test/logic.test.mjs — run with: node test/logic.test.mjs
// Checks the non-visual logic against the real packet: tracing, the checks, sign-off reopening.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildIndex, docLanding } from '../src/packetIndex.js';
import { traceClaim } from '../src/trace.js';
import { printedMatch, duplicateDoc, duplicatePage, claimChecks, worst } from '../src/checks.js';
import { can } from '../src/roles.js';
import { effectiveValue, signoffState, taxEffect, signoffBlocker } from '../src/events.js';

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
