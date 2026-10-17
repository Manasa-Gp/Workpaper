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
import { claimChecks, worst } from './checks.js';
import { loadEvents, saveEvents, appendEvent, verifiedEvent, effectiveValue } from './events.js';
import { renderTopbar } from './views/topbar.js';
import { renderPicker } from './views/picker.js';
import { renderClaim } from './views/claim.js';
import { renderSource } from './views/source.js';
import { h, clear } from './dom.js';

const state = {
  index: null,
  role: 'preparer',
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
};

const els = {
  topbar: document.getElementById('topbar'),
  picker: document.getElementById('picker'),
  claim: document.getElementById('claim'),
  source: document.getElementById('source'),
  app: document.getElementById('app'),
  banner: document.getElementById('banner'),
};

// What the views can ask for. Each handler changes state, then render() redraws.
const on = {
  select(key) {
    if (location.hash.slice(1) === key) { setKey(key); render(); } else location.hash = key; // hashchange -> setKey
  },
  source(ref) { state.sourceRef = ref; render({ scrollToMark: true }); },
  filter(text) { state.filter = text; render(); },
  attention(flag) { state.onlyAttention = flag; render(); },
  group(key, open) { state.groupsOpen.set(key, open); }, // remembered across redraws; no redraw needed
  passed(open) { state.passedOpen = open; }, // remembered across redraws; no redraw needed
  role(roleKey) { state.role = roleKey; render(); },
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
      try { state.events = await loadEvents(); state.loadError = false; } catch { /* still down */ }
      render();
    } else if (state.unsaved.length) flush();
    else save();
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
    state.events = await loadEvents();
  } catch {
    state.events = [];
    state.loadError = true; // banner: could not load saved work, saving is off until you reload
  }
  setKey(decodeURIComponent(location.hash.slice(1)) || 'F1040.1a');
  render();
}

/** One status per line, from the checks in checks.js. Lines with no source documents are 'na'. */
function computeStatuses(index, events) {
  const statuses = new Map();
  for (const line of index.current.lines) {
    if (!line.sources?.length) { statuses.set(line.key, 'na'); continue; }
    const checks = claimChecks(index, traceClaim(index, line.key), effectiveValue(line, events));
    const waiting = checks.some((c) => c.verify && !verifiedEvent(events, line.key, c.verifyKey));
    const status = worst(checks);
    // A line is only 'pass' once every flagged check has been confirmed by a person.
    statuses.set(line.key, status === 'pass' && waiting ? 'warn' : status);
  }
  return statuses;
}

async function save() {
  try { await saveEvents(state.events); state.saveError = false; }
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
      } catch {
        state.saveError = true;
        render();
        return;
      }
    }
    state.saveError = false;
    try { state.events = await loadEvents(); } catch { /* keep what is on screen */ }
    render();
  } finally {
    flushing = false;
  }
}

function renderBanner() {
  const failed = state.loadError || state.saveError;
  els.banner.hidden = !failed;
  clear(els.banner);
  if (!failed) return;
  els.banner.append(
    state.loadError ? 'Could not load saved work, so saving is turned off. ' : 'Not saved on the server yet. ',
    h('button', { type: 'button', class: 'linkish', onClick: () => on.retry() }, 'Retry'),
  );
}

/** Choose a line and open its first source so the document appears straight away. */
function setKey(key) {
  if (!state.index.current.byKey.has(key)) return;
  state.key = key;
  const trace = traceClaim(state.index, key);
  // Open on the problem if there is one: the first source whose check failed or warned.
  const flagged = claimChecks(state.index, trace).find((c) => c.ref && (c.status === 'fail' || c.status === 'warn'));
  const first = trace.sources.find((s) => s.kind === 'value') ?? trace.sources[0];
  state.sourceRef = flagged ? flagged.ref : first ? first.ref : null;
}

function render({ scrollToMark = false } = {}) {
  if (!state.index) return;
  renderBanner();
  state.statusByKey = computeStatuses(state.index, state.events); // events can change a status (verification)
  // Keep the search box focused and the list scrolled while redrawing.
  const active = document.activeElement;
  const keepFocus = active && active.id && ['filter'].includes(active.id) ? { id: active.id, at: active.selectionStart } : null;
  const listScroll = els.picker.querySelector('.picker-list')?.scrollTop ?? 0;

  renderTopbar(els.topbar, state, on);
  renderPicker(els.picker, state, on);
  renderClaim(els.claim, state, on);
  renderSource(els.source, state, on);

  const list = els.picker.querySelector('.picker-list');
  if (list) list.scrollTop = listScroll;
  if (keepFocus) {
    const input = document.getElementById(keepFocus.id);
    input?.focus();
    input?.setSelectionRange(keepFocus.at, keepFocus.at);
  }
  if (scrollToMark) document.getElementById('field-mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else document.getElementById('field-mark')?.scrollIntoView({ block: 'nearest' });
}

window.addEventListener('hashchange', () => {
  if (!state.index) return;
  setKey(decodeURIComponent(location.hash.slice(1)));
  els.claim.scrollTop = 0;
  render({ scrollToMark: true });
});

boot();
