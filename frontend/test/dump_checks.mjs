// test/dump_checks.mjs — prints every claim's checks as JSON, so backend/test_parity.py can compare them with checks.py.
// Run by that test; you do not need to run it yourself.
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/packetIndex.js';
import { traceClaim } from '../src/trace.js';
import { claimChecks } from '../src/checks.js';
import { crossChecks } from '../src/crosschecks.js';

const packet = JSON.parse(readFileSync(new URL('../../backend/data/packet.json', import.meta.url)));
const index = buildIndex(packet);
const slim = (c) => ({ id: c.id, status: c.status, detail: c.detail, verify: Boolean(c.verify), verifyKey: c.verifyKey ?? null, ref: c.ref ?? null });

const out = { plain: {}, adjusted: {}, cross: crossChecks(index).map((c) => ({ id: c.id, status: c.status, detail: c.detail, lines: c.lines, refs: c.refs })) };
for (const line of index.current.lines) {
  if (line.value === null || line.value === undefined) continue;
  out.plain[line.key] = claimChecks(index, traceClaim(index, line.key)).map(slim);
  if (typeof line.value === 'number') out.adjusted[line.key] = claimChecks(index, traceClaim(index, line.key), line.value + 1).map(slim);
}
console.log(JSON.stringify(out));
