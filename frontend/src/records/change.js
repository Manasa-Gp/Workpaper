// records/change.js — Ch2 compare versions, and b15 "what changed since the previous version".
// Both are built fresh from the versions in the packet. Nothing is saved.

import { context, link, diff } from './core.js';

const VERSION_TITLE = (v) => `${v.version} (${String(v.computed_at).slice(0, 10)})`;

/** Every line that was added, removed or changed between two versions, biggest move first. */
export function compareVersions(a, b) {
  const rows = [];
  const keys = new Set([...a.byKey.keys(), ...b.byKey.keys()]);
  for (const key of keys) {
    const x = a.byKey.get(key);
    const y = b.byKey.get(key);
    const was = x?.value ?? null;
    const now = y?.value ?? null;
    if (x && y && was === now) continue;
    rows.push({ key, label: (y ?? x).label, kind: !x ? 'Added' : !y ? 'Removed' : 'Changed', was, now, change: diff(now, was), inNow: Boolean(y) });
  }
  return rows.sort((p, q) => Math.abs(q.change ?? 0) - Math.abs(p.change ?? 0));
}

function tableFor(a, b) {
  const rows = compareVersions(a, b);
  return {
    heading: `${a.version} → ${b.version}: ${rows.length} lines differ`,
    columns: [{ label: 'Line' }, { label: 'What it is' }, { label: 'What happened' }, { label: a.version, num: true }, { label: b.version, num: true }, { label: 'Change', num: true }],
    rows: rows.map((r) => [r.inNow ? link(r.key) : r.key, r.label, r.kind, r.was, r.now, r.change]),
    note: `${VERSION_TITLE(a)} compared with ${VERSION_TITLE(b)}. Biggest movers first.`,
  };
}

/** Ch2: every pair of versions. */
export function versionCompare(state) {
  const vs = state.index.versions;
  const tables = [];
  for (let i = vs.length - 1; i > 0; i -= 1) tables.push(tableFor(vs[i - 1], vs[i])); // newest step first
  if (vs.length > 2) tables.push(tableFor(vs[0], vs[vs.length - 1]));                  // then first against latest
  return { intro: 'Pick the pair you want to look at. Each table lists every line that was added, removed or changed between two versions of the return, worked out from the lines themselves.', tables };
}

/** b15: the engine's own list of changes in the latest version. */
export function changedSinceLast(state) {
  const ctx = context(state);
  const cur = ctx.rv;
  const prev = state.index.versions[state.index.versions.length - 2];
  const list = cur.changes_from_previous ?? [];
  const label = (k) => ctx.index.current.byKey.get(k)?.label ?? prev?.byKey.get(k)?.label ?? '';
  return {
    intro: `What the engine says changed from ${prev?.version ?? 'the last version'} to ${cur.version}: ${list.length} lines. Why: ${cur.trigger}`,
    tables: [{
      heading: `Changed since ${prev?.version ?? 'the last version'}`,
      columns: [{ label: 'Line' }, { label: 'What it is' }, { label: 'What happened' }, { label: 'Old', num: true }, { label: 'New', num: true }, { label: 'Change', num: true }],
      rows: list.map((c) => [ctx.index.current.byKey.has(c.key) ? link(c.key) : c.key, label(c.key), c.change[0].toUpperCase() + c.change.slice(1), c.old ?? null, c.new ?? null, diff(c.new, c.old)]),
    }],
  };
}
