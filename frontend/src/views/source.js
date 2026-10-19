// views/source.js — the right column: the document (or other evidence) behind a number.
//
// Called by: main.js render().
// Reads:     state.sourceRef, set when a source in views/claim.js is clicked.
// Calls back: on.select(key) when "landed in" chips are clicked, on.source(ref) for pages.
//
// THE SWAP POINT FOR REAL DOCUMENTS
// ---------------------------------
// renderDocument() builds a *simulated* document from the packet's printed_content.
// It receives a `locator` (see trace.js locatorFor): document id, page, field, text read
// and a position box. To use real PDFs, replace renderDocument() with a function that
// draws the PDF page and overlays a rectangle from locator.position. Nothing else in the
// app changes, because every number already carries a locator.

import { h, clear } from '../dom.js';
import { docLanding } from '../packetIndex.js';
import { locatorFor, resolveSource } from '../trace.js';
import { printedFor, dupDocFor, dupPageFor } from '../serverchecks.js';
import { day } from '../format.js';
import { recordView } from './record.js';
import { canSeeSensitive } from '../roles.js';

export function renderSource(el, state, on) {
  clear(el);
  if (!state.sourceRef) {
    el.append(h('div', { class: 'source-empty' },
      h('h2', {}, 'Source'),
      h('p', {}, 'Choose a source under “Where it came from” to see the document here, with the exact field marked.'),
    ));
    return;
  }
  const source = resolveSource(state.index, state.sourceRef);
  if (source.kind === 'value' && source.value) {
    el.append(renderDocument(state, source, on));
  } else {
    el.append(renderRecord(source, state, on));
  }
}

// ---------- simulated document ----------

function renderDocument(state, source, on) {
  const { index } = state;
  const value = source.value;
  const doc = source.doc;
  const locator = locatorFor(value);
  const landing = docLanding(index, doc.id);
  const page = doc.pages.find((p) => p.page === locator.page);
  const match = printedFor(state, value.id);

  const extraction = doc.extraction ?? {};
  const banners = [];
  if (extraction.status && extraction.status !== 'extracted') {
    banners.push(h('p', { class: 'banner warn' }, `Extraction: ${extraction.status.replace('_', ' ')}. ${extraction.reason ?? ''}`));
  }
  const dupDoc = dupDocFor(state, doc.id);
  if (dupDoc.status === 'warn') banners.push(h('p', { class: 'banner warn' }, dupDoc.detail));
  const dupPage = dupPageFor(state, doc.id, locator.page);
  if (dupPage.status === 'warn') banners.push(h('p', { class: 'banner warn' }, dupPage.detail));
  if (match.status === 'fail') banners.push(h('p', { class: 'banner fail' }, `${match.detail} The closest printed text is marked in red.`));
  if (match.status === 'warn') banners.push(h('p', { class: 'banner warn' }, match.detail));

  return h('div', { class: 'doc' },
    h('h2', {}, doc.title),
    h('dl', { class: 'meta' },
      meta('Document', doc.id),
      meta('Issuer', doc.issuer),
      meta('Belongs to', doc.belongs_to),
      meta('Received', `${day(doc.received_at)} · uploaded by ${doc.uploaded_by}`),
      meta('Pages', doc.page_count),
      doc.marked_corrected ? meta('Status', 'Marked CORRECTED by the issuer') : null,
    ),
    h('div', { class: 'locator', 'aria-label': 'Where in the document' },
      h('strong', {}, 'Location'),
      ` page ${locator.page} · field “${locator.field}” · ${locator.label}`,
      locator.position
        ? h('span', { class: 'pos' }, `box x ${locator.position.x0}–${locator.position.x1}, y ${locator.position.y0}–${locator.position.y1} (synthetic)`)
        : null,
    ),
    banners,
    h('div', { class: 'tabs', role: 'tablist' },
      doc.pages.map((p) =>
        h('button', {
          type: 'button', role: 'tab', class: `tab${p.page === locator.page ? ' is-on' : ''}`,
          'aria-selected': p.page === locator.page ? 'true' : 'false',
          onClick: () => {
            const other = (index.valuesByDoc.get(doc.id) ?? []).find((v) => v.page === p.page);
            if (other) on.source(other.id);
          },
        }, `Page ${p.page}`),
      ),
    ),
    h('div', { class: 'paper', 'aria-label': `Printed text of ${doc.id} page ${locator.page}` },
      h('p', { class: 'paper-note' }, 'Simulated from the packet’s printed text. A real scan would replace this view.'),
      page ? paperText(page.printed_content, locator, match.status, { state, on, prefix: `${doc.id}:${page.page}` }) : h('p', {}, 'This page is not in the packet.'),
    ),
    h('div', { class: 'landing' },
      h('h3', {}, 'Where this document landed'),
      landing.keys.length
        ? h('div', { class: 'chips' }, landing.keys.slice(0, 40).map((key) => h('button', { type: 'button', class: 'chip', onClick: () => on.select(key) }, key)),
            landing.keys.length > 40 ? h('span', { class: 'more' }, `and ${landing.keys.length - 40} more`) : null)
        : h('p', {}, landing.note),
    ),
  );
}

const meta = (k, v) => (v === undefined ? null : h('div', {}, h('dt', {}, k), h('dd', {}, String(v))));

/** Put the printed text on the page and mark the field. Splits text into before | mark | after. */
function paperText(text, locator, matchStatus, ctx) {
  const found = locate(text, locator);
  const items = splitItems(text);
  const markClass = matchStatus === 'fail' ? 'mark mark-fail' : 'mark';

  // The text of one item, with the marked field inside it if the mark falls there.
  const itemNodes = (item) => {
    if (!found || found.start < item.start || found.start >= item.end) return [text.slice(item.start, item.end)];
    const end = Math.min(found.end, item.end);
    return [text.slice(item.start, found.start), h('mark', { class: markClass, id: 'field-mark' }, text.slice(found.start, end)), text.slice(end, item.end)];
  };
  const linesOf = (list) => list.flatMap((item, i) => (i < list.length - 1 ? [...itemNodes(item), '\n'] : itemNodes(item)));

  // A short page stays as it was. A long one is cut into groups that fold.
  if (items.length <= GROUP_MIN) return h('pre', { class: 'paper-text' }, linesOf(items));

  const groups = [];
  for (let i = 0; i < items.length; i += GROUP_SIZE) groups.push(items.slice(i, i + GROUP_SIZE));
  const pageHasMark = Boolean(found);
  return h('div', { class: 'paper-groups' }, groups.map((group, i) => {
    const key = `${ctx.prefix}:${i}`;
    const hasMark = pageHasMark && found.start >= group[0].start && found.start < group[group.length - 1].end;
    const stored = ctx.state.groupsOpen.get(key);
    // The group holding the marked field is always open; otherwise the reader's choice; first group by default.
    const open = hasMark || stored === true || (stored === undefined && i === 0 && !pageHasMark);
    return h('details', { class: 'paper-group', open, onToggle: (e) => ctx.on.group(key, e.target.open) },
      h('summary', {}, groupLabel(text, group), h('span', { class: 'group-count' }, `${group.length} items`)),
      h('pre', { class: 'paper-text' }, linesOf(group)),
    );
  }));
}

const GROUP_MIN = 10;  // pages with this many items or fewer are not grouped
const GROUP_SIZE = 8;  // items per group

/** Items are the pieces of printed text separated by semicolons (the first one holds the page heading). */
function splitItems(text) {
  const items = [];
  let start = 0;
  for (const m of text.matchAll(/;\s+/g)) {
    items.push({ start, end: m.index + 1 });
    start = m.index + m[0].length;
  }
  items.push({ start, end: text.length });
  return items;
}

/** A name for a group: the date range for a log, otherwise how it starts. */
function groupLabel(text, group) {
  const first = text.slice(group[0].start, group[0].end);
  const last = text.slice(group[group.length - 1].start, group[group.length - 1].end);
  const date = /\d{4}-\d{2}-\d{2}/;
  const a = date.exec(first);
  const b = date.exec(last);
  if (a && b) return a[0] === b[0] ? a[0] : `${a[0]} to ${b[0]}`;
  return first.length > 50 ? `${first.slice(0, 50).trim()}…` : first.replace(/;$/, '');
}

/** Find the printed text for a field: by box label first, then by exact text, then the closest look-alike. */
function locate(text, locator) {
  const read = locator.textAsRead ?? '';
  const box = /^box(\d+)(?:_(\w+))?/i.exec(locator.field ?? '');
  if (read) {
    if (box) {
      const prefix = `Box ${box[1]}${box[2] ? ` ${box[2]}` : ''} `;
      const at = text.indexOf(prefix + read);
      if (at >= 0) return { start: at + prefix.length, end: at + prefix.length + read.length };
    }
    const at = text.indexOf(read);
    if (at >= 0) return { start: at, end: at + read.length };
  }
  // A blank field: mark the "(not reported)" notice that follows the same lot or item.
  if (!read) {
    const item = (locator.field ?? '').split('_')[0];
    const from = item ? text.indexOf(`${item} `) : -1;
    const at = from >= 0 ? text.indexOf('(not reported)', from) : -1;
    if (at >= 0) return { start: at, end: at + '(not reported)'.length };
  }
  // Not printed as read: mark the nearest look-alike so a misread stands out.
  const target = read || String(locator.label ?? '');
  let best = null;
  for (const match of text.matchAll(/[\w$.,\-/]+/g)) {
    const word = match[0].replace(/[.,;]+$/, ''); // do not mark trailing punctuation
    const d2 = editDistance(word, target);
    if (d2 <= 3 && word.length >= 4 && (!best || d2 < best.d)) best = { d: d2, start: match.index, end: match.index + word.length };
  }
  return best;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ---------- evidence that is not a document ----------

function renderRecord(source, state, on) {
  const body = [];
  if (source.kind === 'client' && source.item) {
    const item = source.item;
    body.push(h('h2', {}, `${source.type} ${item.id}`));
    if (item.question) body.push(h('p', { class: 'quote-q' }, item.question), h('p', { class: 'quote' }, item.answer), h('p', { class: 'meta-line' }, `Answered by ${item.answered_by}, ${day(item.answered_at)}`));
    else if (item.text) body.push(h('p', { class: 'quote' }, item.text), h('p', { class: 'meta-line' }, `${item.from} to ${item.to}, ${day(item.sent_at)}`));
    else if (item.notes) body.push(h('p', { class: 'meta-line' }, `${day(item.date)} · ${item.participants.join(', ')}`), h('ul', {}, item.notes.map((n) => h('li', {}, n))));
  } else if (source.kind === 'unread') {
    body.push(h('h2', {}, `${source.doc?.id ?? 'Document'}, page ${source.page}`), h('p', { class: 'banner warn' }, 'The pipeline never read this page. Numbers on it are missing from the return.'));
  } else if (source.kind === 'prior' || source.kind === 'agency' || source.kind === 'param' || source.kind === 'asset' || source.kind === 'person' || source.kind === 'event') {
    const heading = { prior: 'Last year’s record', agency: 'Tax agency record', param: 'Engine parameter', asset: 'Asset record', person: 'Household record', event: 'Timeline event' }[source.kind];
    const found = source.found ?? source.record ?? source.person ?? source.event;
    // Records can hold SSNs, PINs and bank numbers. They are hidden unless a cleared role chooses to reveal them.
    const secret = found !== undefined && JSON.stringify(found).includes('•'); // the server hid numbers here
    const allowed = canSeeSensitive(state.index.packet, state.role); // only decides whether to offer the button; the server decides what it sends
    const real = state.revealed.get(source.ref);
    const shown = secret && allowed && real !== undefined;
    body.push(h('h2', {}, heading), h('p', { class: 'meta-line' }, source.ref));
    if (secret) {
      body.push(h('div', { class: 'sensitive-bar' },
        h('span', {}, shown ? 'Showing sensitive numbers.' : 'Sensitive numbers are hidden.'),
        allowed
          ? h('button', { type: 'button', class: 'btn', onClick: () => on.reveal(source.ref) }, shown ? 'Hide' : 'Reveal')
          : h('span', { class: 'muted' }, ' Your role is not cleared to see them.')));
    }
    body.push(found === undefined ? h('p', {}, 'Nothing found at this location.') : recordView(shown ? real : found));
  } else {
    body.push(h('h2', {}, 'Evidence'), h('p', {}, `No viewer for ${source.ref}.`));
  }
  return h('div', { class: 'doc' }, body);
}
