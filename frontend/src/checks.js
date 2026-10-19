// checks.js — checks that do not trust the pipeline or the engine.
//
// Called by: main.js (statuses for the whole list) and views/claim.js, views/source.js.
// Input:     the index from packetIndex.js, plus values/lines from trace.js.
// Output:    plain objects { id, label, status, detail } where status is one of
//            'pass' | 'warn' | 'fail' | 'na'.
//
// What each check compares:
//   printedMatch   the value the pipeline read  vs  the text printed on that page
//   confidence     the pipeline's own confidence score (never proof on its own)
//   duplicateDoc   other documents from the same issuer with the same figures
//   duplicatePage  other pages inside the same document with the same figures
//   tieOut         the sum of a claim's source values  vs  the claim's value

import { crossChecksFor } from './crosschecks.js';

const RANK = { fail: 3, warn: 2, pass: 1, na: 0 };
export const worst = (checks) =>
  checks.reduce((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), 'na');

// ---------- number helpers ----------

const NUMBER = /\d[\d,]*\.?\d*/g;
const cache = { pageNumbers: new Map() };

function numbersIn(text) {
  const found = new Set();
  for (const match of text.matchAll(NUMBER)) {
    const n = parseFloat(match[0].replace(/,/g, ''));
    if (!Number.isNaN(n)) found.add(Math.round(n * 100) / 100);
  }
  return found;
}

function pageNumbers(doc, page) {
  const key = `${doc.id}#${page.page}`;
  if (!cache.pageNumbers.has(key)) cache.pageNumbers.set(key, numbersIn(page.printed_content));
  return cache.pageNumbers.get(key);
}

const parseMoney = (text) => {
  const cleaned = String(text).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
};

function containment(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const n of a) if (b.has(n)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// ---------- checks on one extracted value ----------

export function printedMatch(index, value) {
  const label = 'Matches the printed page';
  const doc = index.documents.get(value.document_id);
  const page = doc?.pages.find((p) => p.page === value.page);
  if (!page) return { id: 'printed', label, status: 'fail', detail: `Page ${value.page} of ${value.document_id} is not in the packet.` };

  const printed = page.printed_content;
  const read = value.text_as_read ?? '';
  const type = value.value_type;

  if (value.value === null || value.value === undefined) {
    return { id: 'printed', label, status: 'warn', detail: 'The pipeline found no value for this field.' };
  }
  if (read === '') {
    return { id: 'printed', label, status: 'warn', detail: `Nothing is printed in this field. The pipeline recorded ${value.value}.` };
  }

  if (['money', 'integer', 'quantity', 'percent'].includes(type)) {
    const asRead = parseMoney(read);
    if (asRead !== null && Math.abs(Math.abs(asRead) - Math.abs(value.value)) > 0.011 && type !== 'percent') {
      return { id: 'printed', label, status: 'fail', detail: `Text read as "${read}" but stored as ${value.value}.` };
    }
    const numbers = pageNumbers(doc, page);
    const target = Math.round(Math.abs(value.value) * 100) / 100;
    const hit = numbers.has(target) || (type === 'percent' && (numbers.has(target * 100) || numbers.has(target / 100)));
    if (hit) return { id: 'printed', label, status: 'pass', detail: `${read} appears on the printed page.` };
    if (target === 0) return { id: 'printed', label, status: 'warn', detail: 'The page prints no such figure. A blank was recorded as 0.' };
    return { id: 'printed', label, status: 'fail', detail: `${read} does not appear on the printed page.` };
  }

  if (type === 'date') {
    const iso = String(value.value);
    const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso);
    const us = m ? `${m[2]}/${m[3]}/${m[1]}` : null;
    if (printed.includes(iso) || (us && printed.includes(us))) return { id: 'printed', label, status: 'pass', detail: `${read} appears on the printed page.` };
    return { id: 'printed', label, status: 'fail', detail: `${read} does not appear on the printed page.` };
  }

  if (type === 'boolean') return { id: 'printed', label, status: 'na', detail: 'Checkbox. Not compared.' };

  const lower = printed.toLowerCase();
  if (lower.includes(String(value.value).toLowerCase()) || lower.includes(read.toLowerCase())) {
    return { id: 'printed', label, status: 'pass', detail: `"${read}" appears on the printed page.` };
  }
  return { id: 'printed', label, status: 'fail', detail: `"${read}" does not appear on the printed page.` };
}

export function confidence(value) {
  const label = 'Pipeline confidence';
  const c = value.confidence;
  if (typeof c !== 'number') return { id: 'confidence', label, status: 'na', detail: 'No score.' };
  if (c < 0.5) return { id: 'confidence', label, status: 'fail', detail: `${c.toFixed(2)}. Too low to rely on.` };
  if (c < 0.8) return { id: 'confidence', label, status: 'warn', detail: `${c.toFixed(2)}. Worth a second look.` };
  return { id: 'confidence', label, status: 'pass', detail: `${c.toFixed(2)}. A high score is not proof: the packet contains confident mistakes.` };
}

// ---------- checks on documents and pages ----------

export function duplicateDoc(index, docId) {
  const label = 'Not a duplicate document';
  const doc = index.documents.get(docId);
  if (!doc) return { id: 'dupdoc', label, status: 'na', detail: '' };
  const mine = docNumbers(doc);
  for (const other of index.documents.values()) {
    if (other.id === docId || other.issuer !== doc.issuer || other.document_type !== doc.document_type) continue;
    const theirs = docNumbers(other);
    if (mine.size < 5 || theirs.size < 5) continue; // too little data to call a duplicate
    if (containment(mine, theirs) < 0.9) continue;

    const superseded = index.versions.flatMap((v) => v.documents_superseded ?? []);
    if (superseded.includes(other.id) || superseded.includes(docId)) {
      const old = superseded.includes(docId) ? docId : other.id;
      const replacement = old === docId ? other.id : docId;
      return { id: 'dupdoc', label, status: 'pass', detail: `${old} was superseded by ${replacement}. The engine uses ${replacement}.` };
    }
    // doc and other are kept so claimChecks can answer "is it counted once?" from the line's own sources.
    return { id: 'dupdoc', label, status: 'warn', doc: docId, other: other.id, detail: `Same issuer and the same figures as ${other.id}. Probably the same document uploaded twice.` };
  }
  return { id: 'dupdoc', label, status: 'pass', detail: 'No other document from this issuer has the same figures.' };
}

const docNumberCache = new Map();
function docNumbers(doc) {
  if (!docNumberCache.has(doc.id)) {
    const all = new Set();
    for (const page of doc.pages) for (const n of numbersIn(page.printed_content)) all.add(n);
    docNumberCache.set(doc.id, all);
  }
  return docNumberCache.get(doc.id);
}

export function duplicatePage(index, docId, pageNo) {
  const label = 'Not a duplicate page';
  const doc = index.documents.get(docId);
  const page = doc?.pages.find((p) => p.page === pageNo);
  if (!page) return { id: 'duppage', label, status: 'na', detail: '' };
  const mine = pageNumbers(doc, page);
  if (mine.size < 8) return { id: 'duppage', label, status: 'na', detail: 'Too little printed data to compare.' };
  for (const other of doc.pages) {
    if (other.page === pageNo) continue;
    const theirs = pageNumbers(doc, other);
    if (theirs.size >= 8 && containment(mine, theirs) >= 0.9) {
      return {
        id: 'duppage', label, status: 'warn',
        docId, pages: [pageNo, other.page].sort((a, b) => a - b), // lets claimChecks show one row per pair
        detail: `Page ${pageNo} has the same dates and figures as page ${other.page}. It may be a second scan of the same sheet, which would be counted twice.`,
      };
    }
  }
  return { id: 'duppage', label, status: 'pass', detail: 'No other page in this document has the same figures.' };
}

export function sourceChecks(index, value) {
  return [
    printedMatch(index, value),
    confidence(value),
    duplicateDoc(index, value.document_id),
    duplicatePage(index, value.document_id, value.page),
  ];
}

// ---------- checks on a claim (a line of the return) ----------

/** Does the sum of the source values equal the line? Only for lines whose rule is a plain sum of sources. */
export function tieOut(line, sources) {
  const label = 'Sources add up to the line';
  const isSumRule = /SUM|TOTALS/.test(line.rule ?? '') && (line.inputs ?? []).length === 0;
  const values = sources.filter((s) => s.kind === 'value' && s.value && typeof s.value.value === 'number');
  if (!isSumRule || values.length === 0 || values.length !== sources.length) {
    return { id: 'tie', label, status: 'na', detail: 'Not a plain sum of source values.' };
  }
  const total = values.reduce((acc, s) => acc + s.value.value, 0);
  const diff = Math.round((total - line.value) * 100) / 100;
  if (Math.abs(diff) < 0.5) return { id: 'tie', label, status: 'pass', detail: `${values.map((s) => s.value.value.toLocaleString('en-US')).join(' + ')} = ${total.toLocaleString('en-US')}.`, total };
  return { id: 'tie', label, status: 'fail', detail: `Sources add to ${total.toLocaleString('en-US')}, the line says ${line.value.toLocaleString('en-US')}.`, total };
}

/** All checks for one claim: its own tie-out plus every check on each source value. */
export function claimChecks(index, trace, adjustedValue) {
  const checks = [tieOut(trace.line, trace.sources)];
  const cross = crossChecksFor(index, trace.line.key); // Block 13: set against the IRS, the FTB and the documents
  const seen = new Set();
  for (const source of trace.sources) {
    if (source.kind === 'unread') {
      checks.push({ id: `unread-${source.ref}`, label: 'Page was read', status: 'warn', detail: `${source.doc?.id} page ${source.page} was never read by the pipeline.`, ref: source.ref });
    }
    if (source.kind !== 'value' || !source.value) continue;
    for (const check of sourceChecks(index, source.value)) {
      const key = `${check.id}|${check.status}|${check.detail}|${source.value.document_id}`;
      if (check.id !== 'printed' && check.id !== 'confidence' && seen.has(key)) continue;
      seen.add(key);
      // Page 2 vs page 3 and page 3 vs page 2 are one finding: one row, with both sources.
      const pair = check.id === 'duppage' && check.pages ? `${check.docId}:${check.pages.join('-')}` : null;
      const earlier = pair && checks.find((c) => c.pair === pair);
      if (earlier) { earlier.refs.push(source.ref); continue; }
      checks.push(pair
        ? { ...check, pair, ref: source.ref, refs: [source.ref],
            detail: `Pages ${check.pages.join(' and ')} of ${check.docId} have the same dates and figures. It may be a second scan of the same sheet, which would be counted twice.` }
        : { ...check, ref: source.ref });
    }
  }
  // If a person changed the number, the sources are checked against the number now on screen too.
  // The engine-value row above stays, so the original result is still visible.
  const adjusted = adjustedMismatch(trace.line, checks[0], adjustedValue);
  if (adjusted) checks.splice(1, 0, adjusted);
  checks.push(...cross);
  return checks.map((c) => resolveDuplicate(c, trace, checks[0]));
}

/** A warning row when an adjusted value no longer equals the sum of the sources. Null if not adjusted or not a plain sum. */
function adjustedMismatch(line, tie, adjustedValue) {
  if (typeof adjustedValue !== 'number' || adjustedValue === line.value || typeof tie.total !== 'number') return null;
  if (Math.abs(tie.total - adjustedValue) < 0.5) return null;
  const fmt = (n) => n.toLocaleString('en-US');
  return {
    id: 'tieAdjusted',
    label: 'Adjusted value matches its sources',
    status: 'warn',
    detail: `Adjusted value no longer matches its sources: they add to ${fmt(tie.total)}, the number now says ${fmt(adjustedValue)}.`,
  };
}

/**
 * A duplicate-document warning asks "is it counted once?". For one claim the data answers it:
 * if the copy is not among the line's sources and the sources add up, it is counted once.
 * Then the warning becomes a note (status pass, with the reasoning written out).
 */
function resolveDuplicate(check, trace, tie) {
  if (check.id !== 'dupdoc' || check.status !== 'warn' || !check.other) return check;
  const sourceDocs = new Set(trace.sources.map((s) => s.value?.document_id ?? s.doc?.id).filter(Boolean));
  if (sourceDocs.has(check.other) || tie.status !== 'pass') return check;
  return {
    ...check,
    label: `Possible copy of ${check.other}`,
    status: 'pass',
    verify: true, // passes, but a reviewer should confirm it (claim.js shows the button)
    verifyKey: `dupdoc:${check.doc}:${check.other}`,
    detail: `${check.doc} looks like a copy of ${check.other}, but ${check.other} is not a source of this line (its sources are ${[...sourceDocs].join(' and ')}), and the sources add up: ${tie.detail} Counted once.`,
  };
}
