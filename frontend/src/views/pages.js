// views/pages.js — the pages behind the top tabs: Approval, Filing, Records, Team.
//
// Called by: main.js render() when state.page is not 'review'.
// History: Activity is shown to every role (the server already hides private questions from roles that may not read them);
// "Who opened what" only to roles with the 'viewlog' permission (Reviewer, Partner, Quality reviewer, Administrator).
// These pages draw the same panels that used to be stacked in the left column; nothing about them changed,
// they just have a page of their own now. Each panel opens by default so a page is never a row of closed boxes.
// Calls back: on.page(name) to switch tabs (through the top bar), on.record(id) to leave a record.

import { h, clear } from '../dom.js';
import { inbox } from './inbox.js';
import { approval } from './approval.js';
import { activity } from './activity.js';
import { filing } from './filing.js';
import { clientCopy } from './clientcopy.js';
import { notices } from './notice.js';
import { nextYear } from './nextyear.js';
import { standards } from './standards.js';
import { timeBudget } from './timebudget.js';
import { viewLogPage } from './viewlogpage.js';
import { recordsPanel, renderRecord } from './records.js';
import { history } from './claim.js';
import { eventsFor } from '../events.js';
import { day } from '../format.js';

// Which tabs exist for a role. The client sees only Approval (their summary, approve and sign) and Filing (status).
export function pagesFor(role) {
  const all = [
    { id: 'review', label: 'Review' },
    { id: 'approval', label: 'Approval' },
    { id: 'filing', label: 'Filing' },
    { id: 'documents', label: 'Your documents' }, // the client's own uploads; staff read documents on the Review tab instead
    { id: 'records', label: 'Records' },
    { id: 'history', label: 'History' },
    { id: 'team', label: 'Team' },
  ];
  if (role === 'admin') return all.filter((p) => p.id === 'history'); // manages access, does not see returns: only the access log
  return role === 'client' ? all.filter((p) => ['approval', 'documents', 'filing'].includes(p.id)) : all.filter((p) => p.id !== 'documents');
}

const TITLES = {
  approval: ['Step 2 of 3', 'Approval'],
  filing: ['Step 3 of 3', 'Filing, notices and next year'],
  records: ['Records', 'Records and reports'],
  documents: ['Your documents', 'What you sent us'],
  history: ['History', 'Everything that happened, and who opened what'], // the administrator's page title is set below
  team: ['Team', 'My work, standards and time'],
};

export function renderPage(el, state, on) {
  clear(el);
  const [eyebrow, title] = state.role === 'admin' && state.page === 'history' ? ['Access', 'Who opened what'] : TITLES[state.page] ?? ['', ''];
  if (state.page === 'records' && state.record) {
    renderRecord(el, state, on);
    return;
  }
  const panels = {
    documents: () => clientDocuments(state),
    approval: () => [approval(state, on), clientCopy(state)],
    filing: () => [filing(state, on), notices(state, on), nextYear(state, on)],
    records: () => [recordsPanel(state, on)],
    history: () => state.role === 'admin' ? [viewLogPage(state, on)] : [
      // the number open on the Review tab: its own notes, adjustments and sign-offs, oldest at the bottom
      h('details', { class: 'activity', open: true }, h('summary', {}, `History of ${state.key}`), history(eventsFor(state.events, state.key).filter((e) => !e.private))),
      activity(state, on),
      viewLogPage(state, on),
    ],
    team: () => [inbox(state, on), standards(state, on), timeBudget(state, on)],
  }[state.page]?.() ?? [];
  const parts = panels.filter(Boolean);
  for (const p of parts) if (p.tagName === 'DETAILS') p.open = true;
  el.append(
    h('header', { class: 'claim-head' }, h('p', { class: 'eyebrow' }, eyebrow), h('h1', {}, title)),
    h('div', { class: 'page-panels' }, parts.length ? parts : h('p', { class: 'muted' }, 'Nothing here for this role.')),
  );
}

/** The documents the client uploaded themselves, newest first. Sensitive numbers arrive already masked from the server. */
function clientDocuments(state) {
  const mine = state.index.packet.documents.filter((d) => d.uploaded_by === 'client')
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  if (!mine.length) return [h('p', { class: 'muted' }, 'You have not sent us any documents yet.')];
  return mine.map((doc) => h('details', { class: 'client-doc' },
    h('summary', {}, doc.title, h('span', { class: 'muted' }, ` · received ${day(doc.received_at)} · ${doc.page_count} page${doc.page_count === 1 ? '' : 's'}`)),
    (doc.pages ?? []).map((pg) => h('div', { class: 'client-doc-page' },
      h('p', { class: 'eyebrow' }, `Page ${pg.page}`),
      h('p', { class: 'paper-text' }, pg.printed_content ?? ''))),
  ));
}
