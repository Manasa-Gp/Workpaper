// main.js — the entry point. Start reading the code here.
//
// FLOW
//   index.html loads this file as a module.
//   boot()                       loadPacket.js    get the JSON (GET /api/packet, or a file picker)
//     -> start(packet)           packetIndex.js   build lookup tables
//     -> computeStatuses()       trace.js + checks.js   one status per line, for the list
//     -> render()                views/*          draw the four areas of the page
//   A click in any view calls one of the `on` handlers below, which changes `state`
//   (or saves an event through events.js) and calls render() again.
//
// STATE (the only mutable thing; views never change it directly)
//   index          lookup tables from packetIndex.js
//   role           who is acting (roles.js)
//   key            the line being shown, e.g. 'F1040.1a'   (also kept in the URL hash)
//   sourceRef      the evidence open on the right, e.g. 'ev-0016'
//   events         notes, adjustments, sign-offs (events.js, saved on the server)
//   statusByKey    Map line key -> 'pass' | 'warn' | 'fail' | 'na'
//   filter, onlyAttention   the list's search box and toggle

import { loadFromBackend, readPacketFile } from './loadPacket.js';
import { buildIndex } from './packetIndex.js';
import { traceClaim } from './trace.js';
import { checksFor, loadChecks, loadSignoffCheck, worst } from './serverchecks.js';
import { loadEvents, saveEvents, appendEvent, verifiedEvent, effectiveValue } from './events.js';
import { recordView, loadViews, loadAllViews } from './viewlog.js';
import { actor, can } from './roles.js';
import { readSince, writeSince } from './lastvisit.js';
import { buildBatch, lastBatch, undoEvent, withoutUndone } from './batch.js';
import { renderTopbar } from './views/topbar.js';
import { renderPicker } from './views/picker.js';
import { renderClaim } from './views/claim.js';
import { renderRecord } from './views/records.js';
import { renderSource } from './views/source.js';
import { renderPage, pagesFor } from './views/pages.js';
import { statusBar } from './views/statuscounts.js';
import { h, clear } from './dom.js';

const state = {
  index: null,
  refusal: '', // why the server refused the last change, until dismissed
  signoffCheck: null, // { key, role, events, problem }: the server's answer to "may this role sign this line off now?"
  serverChecks: null, // the server's answer from GET /api/checks (see serverchecks.js)
  role: 'preparer',
  since: readSince('preparer'), // Ch1: when this role last looked (this browser only)
  onlyNew: false,
  tryIt: new Map(), // Ch3: what-if values (key -> number). Memory only, never saved
  selectMode: false, // Ch4: choosing several lines
  selected: new Set(),
  batchMsg: '',
  batchText: '',
  tool: null, // which "More tools" panel is open on the claim page
  page: 'review', // which top tab is open: review | approval | filing | records | team
  key: 'F1040.1a',
  sourceRef: null,
  events: [],
  statusByKey: new Map(),
  filter: '',
  onlyAttention: false,
  groupsOpen: new Map(), // which folded groups of printed text are open (key: doc:page:group)
  passedOpen: false, // is the "N checks passed" list open?
  saveError: false,
  loadError: false,
  unsaved: [],
  viewsFor: null, // { key, list }: the view log of the open line, loaded for roles that may read it
  record: null, // id of the record open in the middle column, or null while a line is shown
  recordsOpen: false,
  allViews: null, // the whole view log, loaded while the "Who opened what" panel is open
  viewLogOpen: false,
  revealed: new Map(), // ref -> the real record the server sent to a cleared role (cleared when the role changes)
};

const els = {
  topbar: document.getElementById('topbar'),
  picker: document.getElementById('picker'),
  claim: document.getElementById('claim'),
  source: document.getElementById('source'),
  app: document.getElementById('app'),
  banner: document.getElementById('banner'),
  statusbar: document.getElementById('statusbar'),
  batchstrip: document.getElementById('batchstrip'),
};

// What the views can ask for. Each handler changes state, then render() redraws.
const on = {
  select(key) {
    if (state.role === 'client') return; // the client has no line pages
    state.record = null; // opening a line closes any open record
    state.page = 'review'; // and takes you to the Review tab
    if (location.hash.slice(1) === key) { setKey(key); render(); } else location.hash = key; // hashchange -> setKey
  },
  source(ref) { state.sourceRef = ref; render({ scrollToMark: true }); trackView(ref, 'source'); },
  filter(text) { state.filter = text; render(); },
  attention(flag) { state.onlyAttention = flag; render(); },
  onlyNew(flag) { state.onlyNew = flag; render(); },
  tryIt(key, value) { if (value === null) state.tryIt.delete(key); else state.tryIt.set(key, value); render(); },
  tryClear() { state.tryIt = new Map(); render(); },
  batchText(t) { state.batchText = t; }, // remembered across redraws; no redraw needed
  selectMode(flag) { state.selectMode = flag; if (!flag) { state.selected = new Set(); state.batchMsg = ''; } render(); },
  toggleSel(key) { if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key); state.batchMsg = ''; render(); },
  selectMany(keys) { state.selected = new Set(keys); state.batchMsg = ''; render(); },
  batch(kind, text) {
    const who = actor(state.index.packet, state.role);
    const { events, skipped } = buildBatch(state, kind, text, who);
    if (!events.length) { state.batchMsg = kind === 'verify' ? 'None of the selected lines has a check waiting for verification.' : 'Nothing selected.'; render(); return; }
    state.batchMsg = `Applied ${events.length} change${events.length === 1 ? '' : 's'} to ${new Set(events.map((e) => e.claim)).size} lines${skipped ? `; ${skipped} had nothing to do` : ''}.`;
    state.selected = new Set();
    state.batchText = '';
    state.events = [...state.events, ...events];
    state.unsaved = [...state.unsaved, ...events];
    render();
    flush();
  },
  undoBatch() {
    const last = lastBatch(state.events);
    if (!last) return;
    const ev = undoEvent(last, actor(state.index.packet, state.role));
    state.batchMsg = `Undid the last batch (${last.count} changes).`;
    state.events = withoutUndone([...state.events, ev]);
    state.unsaved = [...state.unsaved, ev];
    render();
    flush();
  },
  seen() { state.since = writeSince(state.role); state.onlyNew = false; render(); }, // "Mark all as seen"
  group(key, open) { state.groupsOpen.set(key, open); }, // remembered across redraws; no redraw needed
  record(id) { state.record = id; state.page = 'records'; if (id) state.recordsOpen = true; render(); els.claim.scrollTop = 0; },
  tool(name) { state.tool = name; render({ scrollToTool: name !== null }); },
  page(name) { state.page = name; state.record = null; render(); els.claim.scrollTop = 0; },
  recordsOpen(open) { state.recordsOpen = open; },
  passed(open) { state.passedOpen = open; }, // remembered across redraws; no redraw needed
  viewLog(open) { if (open === state.viewLogOpen) return; state.viewLogOpen = open; if (open) refreshAllViews(); }, // load the whole log while its panel is open
  role(roleKey) { if (!pagesFor(roleKey).some((p) => p.id === state.page)) { state.page = pagesFor(roleKey)[0].id; state.record = null; } pending = null; showNewBar(); writeSince(state.role); state.role = roleKey; state.since = readSince(roleKey); state.onlyNew = false; state.revealed.clear(); state.allViews = null; render(); refreshViews(); refreshEvents(); if (state.viewLogOpen) refreshAllViews(); },
  async reveal(ref) { // show or hide the sensitive numbers of one record; the server checks the role and logs the reveal
    if (state.revealed.has(ref)) { state.revealed.delete(ref); render(); return; }
    try {
      const res = await fetch(`/api/reveal?ref=${encodeURIComponent(ref)}&as=${encodeURIComponent(state.role)}`);
      if (!res.ok) return;
      state.revealed.set(ref, (await res.json()).record);
      state.viewsFor = null;
      render();
    } catch { /* server unreachable: stay hidden */ }
  }, // the log is only readable by some roles
  add(event) {
    if (state.loadError) return;
    state.events = [...state.events, event];
    state.unsaved = [...state.unsaved, event];
    render();
    flush();
  },
  reset() {
    if (state.loadError) return;
    state.events = [];
    state.unsaved = [];
    render();
    save();
  },
  async retry() {
    if (state.loadError) {
      try { state.events = await loadEvents(roleLabel()); state.loadError = false; } catch { /* still down */ }
      render();
    } else if (state.unsaved.length) flush();
    else { // nothing of ours is waiting: just fetch the server's list again (never overwrite it)
      try { state.events = await loadEvents(roleLabel()); state.saveError = false; } catch { state.saveError = true; }
      render();
    }
  },
};


async function boot() {
  const packet = await loadFromBackend();
  if (packet) return start(packet);
  showFilePicker();
}

function showFilePicker() {
  clear(els.app);
  els.app.classList.add('is-start');
  els.app.append(
    h('div', { class: 'start' },
      h('h1', {}, 'Load the packet'),
      h('p', {}, 'The backend has no packet. Put packet.json in backend/data/ and reload, or choose it here. The file is read in your browser and not uploaded.'),
      h('input', {
        type: 'file', accept: '.json,application/json', id: 'packet-file', 'aria-label': 'Choose the packet JSON file',
        onChange: async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try { start(await readPacketFile(file)); } catch { e.target.value = ''; alert('That file is not valid JSON.'); }
        },
      }),
    ),
  );
}

async function start(packet) {
  location.hash = location.hash || state.key; // keep an existing deep link
  els.app.classList.remove('is-start');
  clear(els.app);
  els.app.append(els.picker, els.claim, els.source);
  state.index = buildIndex(packet);
  try {
    state.events = await loadEvents(roleLabel());
  } catch {
    state.events = [];
    state.loadError = true; // banner: could not load saved work, saving is off until you reload
  }
  try { state.serverChecks = await loadChecks(); checkedFor = state.events; } catch { state.serverChecks = null; } // the server works out every check
  setKey(decodeURIComponent(location.hash.slice(1)) || 'F1040.1a');
  render();
}

/** One status per line, from the server's checks. Lines with no source documents are 'na'. */
function computeStatuses(state) {
  const { index, events } = state;
  const statuses = new Map();
  for (const line of index.current.lines) {
    if (!line.sources?.length) { statuses.set(line.key, 'na'); continue; }
    const checks = checksFor(state, traceClaim(index, line.key));
    const waiting = checks.some((c) => c.verify && !verifiedEvent(events, line.key, c.verifyKey));
    const status = worst(checks);
    // A line is only 'pass' once every flagged check has been confirmed by a person.
    statuses.set(line.key, status === 'pass' && waiting ? 'warn' : status);
  }
  return statuses;
}

async function save() {
  try { await saveEvents(state.events, actor(state.index.packet, state.role).role); state.saveError = false; }
  catch { state.saveError = true; }
  render();
}
let flushing = false;

/** Sends unsaved events to the server one at a time, oldest first, then reloads the list. */
async function flush() {
  if (flushing) return; // a send is already running; it will pick up new events too
  flushing = true;
  try {
    while (state.unsaved.length) {
      try {
        await appendEvent(state.unsaved[0]);
        state.unsaved = state.unsaved.slice(1);
      } catch (err) {
        if (err.rejected) { // not allowed for this role: drop it instead of retrying forever
          const refused = state.unsaved[0];
          state.unsaved = state.unsaved.slice(1);
          state.events = state.events.filter((e) => e.id !== refused.id);
          state.refusal = err.message; // shown in the banner so the person knows why nothing happened
          continue;
        }
        state.saveError = true;
        render();
        return;
      }
    }
    state.saveError = false;
    try { state.events = await loadEvents(roleLabel()); } catch { /* keep what is on screen */ }
    channel?.postMessage('saved'); // other tabs of this app check straight away instead of waiting for the 10 s timer
    render();
  } finally {
    flushing = false;
  }
}

function renderBanner() {
  const failed = state.loadError || state.saveError || state.refusal;
  els.banner.hidden = !failed;
  clear(els.banner);
  if (!failed) return;
  els.banner.append(
    state.loadError ? 'Could not load saved work, so saving is turned off. ' : state.saveError ? 'Not saved on the server yet. ' : `Not allowed: ${state.refusal} `,
    state.loadError || state.saveError
      ? h('button', { type: 'button', class: 'linkish', onClick: () => on.retry() }, 'Retry')
      : h('button', { type: 'button', class: 'linkish', onClick: () => { state.refusal = ''; render(); } }, 'Dismiss'),
  );
}

/** Choose a line and open its first source so the document appears straight away. */
function setKey(key) {
  if (!state.index.current.byKey.has(key)) return;
  state.key = key;
  state.tool = null;
  state.record = null;
  const trace = traceClaim(state.index, key);
  // Open on the problem if there is one: the first source whose check failed or warned.
  const flagged = checksFor(state, trace).find((c) => c.ref && (c.status === 'fail' || c.status === 'warn'));
  const first = trace.sources.find((s) => s.kind === 'value') ?? trace.sources[0];
  state.sourceRef = flagged ? flagged.ref : first ? first.ref : null;
  trackView(key, 'line');
}

/** The view log of one line, or [] without asking the server when this role may not read it (avoids a pointless 403). */
const readViews = async (key) => (can(state.role, 'viewlog') ? loadViews(key, roleLabel()) : []);

/** The label the server knows the current role by (e.g. 'Reviewer'). */
const roleLabel = () => actor(state.index.packet, state.role).role;

/** Different roles may read different events (private questions), so switching role reloads them. */
async function refreshEvents() {
  if (!state.index || state.loadError || state.unsaved.length) return;
  try { state.events = await loadEvents(roleLabel()); render(); } catch { /* keep what is on screen */ }
}

/** Reload the view log of the open line for the current role (used after switching role). */
async function refreshViews() {
  const key = state.key;
  state.viewsFor = { key, list: await readViews(key) };
  if (state.key === key) render();
}

/** Reload the whole view log (for the "Who opened what" panel) when this role may read it. */
async function refreshAllViews() {
  if (!can(state.role, 'viewlog')) { state.allViews = null; return; }
  state.allViews = await loadAllViews(roleLabel());
  render();
}

/** Log that the current role opened something, then (for roles that may) reload the log of the open line. */
async function trackView(target, kind) {
  const who = actor(state.index.packet, state.role);
  await recordView(target, kind, who);
  if (state.viewLogOpen) refreshAllViews();
  if (kind !== 'line' || state.key !== target) return;
  state.viewsFor = { key: target, list: await readViews(target) };
  if (state.key === target) render();
}

// Text typed into a box but not sent yet. The page redraws by clearing and rebuilding, which would
// wipe it (after any send, when another tab's change arrives, or when you click another line).
// So it is saved per line and role as you leave, and put back when that line is shown again.
// Boxes in the return approval panel belong to the whole return, so they are saved per role only.
// It lives in memory: reloading the page forgets unsent text.
const DRAFT_FIELDS = 'textarea, input[type="text"], input[type="number"], input[type="date"], select';
const draftStore = new Map(); // "line|role::box" -> text typed but not sent
let draftScope = '';

const draftKey = (el) => el.id || el.getAttribute('aria-label');
const inDraftArea = (el) => Boolean(draftKey(el)) && Boolean(el.closest('#claim, .approval'));
const draftSlot = (el, scope) => `${el.closest('.approval') ? `return|${scope.split('|')[1]}` : scope}::${draftKey(el)}`;

/** Save what is typed in the boxes now showing (they belong to `scope`). */
function saveDrafts(scope) {
  for (const el of document.querySelectorAll(DRAFT_FIELDS)) {
    if (!inDraftArea(el)) continue;
    if (el.value) draftStore.set(draftSlot(el, scope), el.value);
    else draftStore.delete(draftSlot(el, scope));
  }
}

/** Put back what was typed for `scope` in the boxes just drawn. */
function restoreDrafts(scope) {
  for (const el of document.querySelectorAll(DRAFT_FIELDS)) {
    if (!inDraftArea(el)) continue;
    const saved = draftStore.get(draftSlot(el, scope));
    if (saved !== undefined && el.value !== saved) el.value = saved;
  }
}

// Ask the server for fresh checks whenever the saved events have changed since the last answer.
let checkedFor = null; let fetchingChecks = false;
function ensureChecks() {
  if (!state.index || fetchingChecks || state.unsaved.length || checkedFor === state.events) return;
  fetchingChecks = true;
  const asked = state.events;
  loadChecks().then((r) => { state.serverChecks = r; }, () => { state.serverChecks = null; })
    .finally(() => { fetchingChecks = false; checkedFor = asked; render(); });
}

// Ask the server whether this role may sign the open line off. The answer is the server's own rule, not a copy of it.
let fetchingSignoff = false;
function ensureSignoffCheck() {
  const have = state.signoffCheck;
  if (!state.index || state.record || fetchingSignoff || state.unsaved.length || !can(state.role, 'signoff')) return;
  if (have && have.key === state.key && have.role === state.role && have.events === state.events) return;
  fetchingSignoff = true;
  const ask = { key: state.key, role: state.role, events: state.events };
  loadSignoffCheck(ask.key, ask.role).then((problem) => ({ ...ask, problem }), () => ({ ...ask, problem: null }))
    .then((answer) => { state.signoffCheck = answer; }).finally(() => { fetchingSignoff = false; render(); });
}

function render({ scrollToMark = false, scrollToTool = false } = {}) {
  if (!state.index) return;
  ensureChecks();
  ensureSignoffCheck();
  const scope = `${state.key}|${state.role}`;
  if (draftScope) saveDrafts(draftScope); // the boxes still on screen belong to the line and role we are leaving
  draftScope = scope;
  renderBanner();
  state.statusByKey = computeStatuses(state); // events can change a status (verification)
  // Keep the search box focused and the list scrolled while redrawing.
  const active = document.activeElement;
  const keepFocus = active && active.id && ['filter'].includes(active.id) ? { id: active.id, at: active.selectionStart } : null;
  const draftFocus = active && inDraftArea(active) && active.selectionStart !== undefined ? { key: draftKey(active), at: active.selectionStart } : null;
  const listScroll = els.picker.querySelector('.picker-list')?.scrollTop ?? 0;
  const claimScroll = els.claim.scrollTop; // a click redraws the page; keep the reader where they were
  const sourceScroll = els.source.scrollTop;

  renderTopbar(els.topbar, state, on);
  renderPicker(els.picker, state, on, els.batchstrip);
  const onReview = state.page === 'review';
  if (!onReview) els.batchstrip.hidden = true; // the batch bar belongs to the line list on the Review tab
  clear(els.statusbar); // the counts sit in a strip under the top bar, on every tab for staff
  const strip = statusBar(state);
  els.statusbar.hidden = !strip;
  if (strip) els.statusbar.append(strip);
  els.app.classList.toggle('is-page', !onReview); // other tabs use one wide column
  els.picker.hidden = els.source.hidden = !onReview;
  if (!onReview) renderPage(els.claim, state, on);
  else if (state.record) renderRecord(els.claim, state, on);
  else renderClaim(els.claim, state, on);
  renderSource(els.source, state, on);

  const list = els.picker.querySelector('.picker-list');
  if (list) list.scrollTop = listScroll;
  els.claim.scrollTop = claimScroll;
  els.source.scrollTop = sourceScroll;
  if (scrollToTool) document.querySelector('.tool-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); // show the panel that was just opened
  restoreDrafts(scope);
  if (draftFocus) {
    const box = [...document.querySelectorAll(DRAFT_FIELDS)].find((el) => draftKey(el) === draftFocus.key);
    box?.focus();
    try { box?.setSelectionRange(draftFocus.at, draftFocus.at); } catch { /* number and date boxes have no caret */ }
  }
  if (keepFocus) {
    const input = document.getElementById(keepFocus.id);
    input?.focus();
    input?.setSelectionRange(keepFocus.at, keepFocus.at);
  }
  if (scrollToMark) document.getElementById('field-mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else document.getElementById('field-mark')?.scrollIntoView({ block: 'nearest' });
}

/**
 * A second tab (or another person) may have added events or views since this tab loaded.
 * When this tab comes back into view, fetch the server's lists and redraw only if they changed,
 * so text being typed is not wiped for nothing. Skipped while there are unsaved events of our own.
 */
async function syncFromServer() {
  if (!state.index || state.loadError || state.unsaved.length || document.hidden) return;
  let changed = false;
  await checkForNew(); // other people's changes arrive as the "N new changes" pill, not silently
  const key = state.key;
  const role = actor(state.index.packet, state.role).role;
  const views = await readViews(key);
  if (state.viewsFor?.key !== key || state.viewsFor.list.length !== views.length) {
    state.viewsFor = { key, list: views };
    changed = true;
  }
  if (changed && state.key === key) render();
}
// Ch5: every 10 seconds ask the server whether anyone else added something. Only a quiet bar changes;
// the page itself is not redrawn, so nobody loses a half-written note.
const newBar = h('div', { class: 'new-bar', role: 'status' });
newBar.style.display = 'none';
document.body.append(newBar);
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('trail-events') : null;
if (channel) channel.onmessage = () => checkForNew();
let pending = null; // { count, events } the server has and this page does not

function showNewBar() {
  clear(newBar);
  if (!pending) { newBar.style.display = 'none'; return; }
  newBar.style.display = '';
  newBar.append(`${pending.count} new change${pending.count === 1 ? '' : 's'} `, h('button', { type: 'button', class: 'linkish', onClick: () => {
    state.events = pending.events;
    pending = null;
    showNewBar();
    render();
  } }, 'Show'));
}

async function checkForNew() {
  if (!state.index || state.loadError || state.unsaved.length || document.hidden) return;
  let list;
  try { list = await loadEvents(roleLabel()); } catch { return; } // server unreachable: stay quiet
  const have = new Set(state.events.map((e) => e.id));
  const count = list.filter((e) => !have.has(e.id)).length;
  if (count === (pending?.count ?? 0)) { if (pending) pending.events = list; return; }
  pending = count ? { count, events: list } : null;
  showNewBar();
}
setInterval(checkForNew, 10000);

window.addEventListener('pagehide', () => writeSince(state.role)); // so the next visit knows where you stopped
document.addEventListener('visibilitychange', syncFromServer);
window.addEventListener('focus', syncFromServer);

window.addEventListener('hashchange', () => {
  if (!state.index) return;
  setKey(decodeURIComponent(location.hash.slice(1)));
  els.claim.scrollTop = 0;
  render({ scrollToMark: true });
});

boot();

// Development only (on localhost): reload the page when a frontend file is saved or the server restarts,
// so you never have to refresh by hand. On a real host this does nothing.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  let seen = null;
  setInterval(async () => {
    try {
      const { v } = await (await fetch('/api/version')).json();
      if (seen === null) seen = v;
      else if (v !== seen) location.reload();
    } catch { /* the server is restarting: try again next second */ }
  }, 1000);
}
