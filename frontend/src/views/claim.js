// views/claim.js — the middle column: one number, with its whole story.
//
// Called by: main.js render().
// Reads:     traceClaim() (trace.js), claimChecks() (checks.js), events.js helpers, roles.js.
// Calls back: on.select(key) to jump to another number, on.source(ref) to open evidence,
//             on.add(event) to save a note / adjustment / sign-off.
//
// Sections, top to bottom:
//   1. The number           value now, engine value if adjusted, sign-off state
//   2. How it was built     rule, and the other numbers it is calculated from (clickable)
//   3. Where it came from   every source (clickable, opens views/source.js)
//   4. Checks               what was compared and the result
//   5. What uses it         lines that depend on this one
//   5b. Related             last year's value, and lines that share evidence
//   6. Notes, changes, sign-off   actions (role-enforced) and the history

import { h, clear } from '../dom.js';
import { traceClaim } from '../trace.js';
import { rejectionsForLine, maskSsn } from '../filing.js';
import { worst } from '../checks.js';
import { checksFor } from '../serverchecks.js';
import { num, signed, dayTime, dueDay } from '../format.js';
import { EVENT_LABEL, filedEvent, filedValue, effectiveValue, questionsFor, reviewPointsFor, assignmentsFor, eventsFor, verifiedEvent, signoffBlocker, signoffState, taxEffect, newEvent, needsPartner, PARTNER_OVER, DECISION_LABEL } from '../events.js';
import { actor, can, WHY_NOT } from '../roles.js';
import { varianceFlags, swingNoteFor } from '../standards.js';
import { tryTotals } from '../batch.js';

const LABEL = { pass: 'Pass', warn: 'Look at this', fail: 'Failed', na: 'Not applicable' };
const GLYPH = { pass: '✓', warn: '!', fail: '×', na: '·' };

export function renderClaim(el, state, on) {
  clear(el);
  const trace = traceClaim(state.index, state.key);
  if (!trace) {
    el.append(h('p', { class: 'empty' }, `No line called ${state.key} in this version.`));
    return;
  }
  const { line } = trace;
  const value = effectiveValue(line, state.events);
  const checks = checksFor(state, trace, value); // value = the number now on screen, adjusted or not
  const waiting = checks.filter((c) => c.verify && !verifiedBy(c, state, line)).length;
  // "pass" is only true once every check that asks for a person's confirmation has it.
  const status = worst(checks) === 'pass' && waiting ? 'warn' : worst(checks);
  const frozen = Boolean(filedEvent(state.events));
  const filedAt = filedValue(state.events, line.key);
  const amended = frozen && filedAt !== null && value !== filedAt;
  const adjusted = value !== line.value && !frozen;
  const so = signoffState(line, state.events);
  const notes = eventsFor(state.events, line.key);

  el.append(
    ...[tryBanner(state, on)].filter(Boolean), // el.append would print "null" when there is no banner
    h('header', { class: 'claim-head' },
      h('p', { class: 'eyebrow' }, `${line.jurisdiction === 'california' ? 'California' : 'Federal'} · ${line.form} line ${line.line}`),
      h('h1', {}, line.label),
      h('p', { class: 'big' }, typeof value === 'number' ? num(value) : String(value)),
      state.tryIt.has(line.key) ? h('p', { class: 'tryit-line' }, h('strong', {}, `What if: ${num(state.tryIt.get(line.key))}`), ` (real value ${num(value)}), not saved`) : null,
      h('div', { class: 'pills' },
        pill(status, waiting && status === 'warn' ? `${waiting} waiting for verification` : status === 'pass' ? 'All checks pass' : status === 'na' ? 'Calculated line' : LABEL[status]),
        adjusted ? h('span', { class: 'pill p-info' }, `Adjusted from engine value ${num(line.value)}`) : null,
        frozen && filedAt !== null && !amended ? h('span', { class: 'pill p-info' }, 'Filed: frozen') : null,
        amended ? h('span', { class: 'pill p-warn' }, `Amended after filing: filed as ${num(filedAt)}`) : null,
        so.state === 'signed' ? h('span', { class: 'pill p-pass' }, `Signed off by ${so.last.by.name}`) : null,
        so.state === 'reopened' ? h('span', { class: 'pill p-warn' }, `Sign-off reopened: value changed from ${num(so.last.valueAtSignoff)}`) : null,
      ),
      changeNote(state.index, line),
      line.note ? h('p', { class: 'engine-note' }, h('strong', {}, 'Engine note '), line.note) : null,
    ),

    safe('E-file rejection', () => rejectionNotice(state, line, on)),

    section('How it was built',
      h('p', { class: 'rule' }, 'Rule ', h('code', {}, line.rule ?? 'none')),
      trace.inputs.length
        ? h('ul', { class: 'links' }, trace.inputs.map((l) => linkRow(l, state, on)))
        : h('p', { class: 'muted' }, trace.sources.length ? 'Read directly from the sources below.' : 'No inputs recorded.'),
    ),

    section('Where it came from',
      trace.sources.length
        ? h('ul', { class: 'sources' }, trace.sources.map((s) => sourceRow(s, state, on)))
        : h('p', { class: 'muted' }, 'This line is calculated from other lines. It has no source documents of its own.'),
      safe('Added by the team', () => addedEvidence(notes, state, line, on)),
    ),

    section('Checks',
      checkList(checks, state, line, on),
      checks.every((c) => c.status === 'na') ? h('p', { class: 'muted' }, 'No automatic checks apply to this line.') : null,
    ),

    trace.feeds.length
      ? section('What uses it', h('ul', { class: 'links' }, trace.feeds.map((l) => linkRow(l, state, on))))
      : '', // el.append(null) would print the word "null"

    safe('Related', () => related(trace, state, on)),

    safe('Who has looked at this', () => viewLog(state)),

    safe('Review points', () => reviewPoints(state, line, on)),
    safe('Assignments', () => assignments(state, line, on)),
    safe('Questions', () => questions(state, line, on)),

    section('Notes, changes and sign-off',
      safe('Actions', () => actions(state, line, value, checks, on)),
      safe('Try it', () => tryItSection(state, line, value, on)),
      safe('Judgment', () => judgment(state, line, on)),
      safe('History', () => history(notes.filter((e) => !e.private))),
    ),
  );
}

// ---------- pieces ----------

const ASK_TO = ['Client', 'Preparer', 'Reviewer', 'Partner'];

/** Review points: a Reviewer or Partner stops a line from being signed until it is dealt with. */
function reviewPoints(state, line, on) {
  if (!can(state.role, 'seepoints')) return ''; // internal to the firm: the client and administrator never see the section
  const who = actor(state.index.packet, state.role);
  const pairs = reviewPointsFor(state.events, line.key);
  const canRaise = can(state.role, 'block');
  const clearButton = (b) => h('button', {
    type: 'button', class: 'btn',
    onClick: () => on.add(newEvent({ claim: line.key, type: 'clear', clears: b.id, by: { name: who.name, role: who.role }, text: 'Dealt with.' })),
  }, 'Clear');
  const text = h('input', { id: 'block-text', type: 'text', placeholder: 'What must be fixed before sign-off?', 'aria-label': 'Review point' });
  const raise = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const t = text.value.trim();
      if (!t) return;
      text.value = ''; // sent: empty the box so the redraw does not bring the text back
      on.add(newEvent({ claim: line.key, type: 'block', by: { name: who.name, role: who.role }, text: t }));
    },
  }, 'Raise review point');
  return section('Review points',
    pairs.length
      ? h('ul', { class: 'question-list' }, pairs.map(({ b, c }) => h('li', {},
          h('p', {}, h('strong', {}, b.text)),
          h('p', { class: 'muted' }, `Raised by ${b.by.name} (${b.by.role}) · ${dayTime(b.at)}`),
          c
            ? h('p', { class: 'muted' }, `✓ Cleared by ${c.by.name} (${c.by.role}) · ${dayTime(c.at)}`)
            : [h('p', { class: 'tag' }, 'Open: blocks sign-off'), canRaise ? clearButton(b) : h('p', { class: 'muted' }, 'Reply with a note; a reviewer or partner clears it.')],
        )))
      : h('p', { class: 'muted' }, 'No review points on this number.'),
    canRaise ? h('div', { class: 'row2' }, text, raise) : null,
  );
}

/**
 * When the IRS rejected the e-file and this line is one the rejection concerns, say so here, next to the number,
 * with the evidence that explains the fix. Nothing is saved: it is read from the packet's e-file record.
 */
function rejectionNotice(state, line, on) {
  const found = rejectionsForLine(state.index.packet, line.key);
  if (!found.length) return '';
  return h('section', { class: 'block rejection' },
    h('h2', {}, 'E-file rejection'),
    found.map(({ submission, error, held, resolvedBy, help }) => h('div', { class: 'rejection-item' },
      h('p', {}, h('strong', {}, `Rejected by the ${submission.jurisdiction === 'federal' ? 'IRS' : 'FTB'} · ${error.code}`), ` · ${dayTime(submission.date)}`),
      h('p', {}, error.message),
      h('p', { class: 'muted' }, help.why),
      help.mismatch
        ? h('div', { class: 'mismatch' },
            h('p', {}, h('strong', {}, 'What went wrong')),
            h('p', {}, `${help.mismatch.person}: the organizer has ${maskSsn(help.mismatch.organizer)}, but the Social Security card says ${maskSsn(help.mismatch.card)}`,
              help.mismatch.swapped ? ' (two digits swapped).' : '.'),
            h('button', { type: 'button', class: 'linkish', onClick: () => on.source(help.mismatch.valueRef) }, `Show ${help.mismatch.docId} (the card the client sent)`))
        : null,
      held.length ? h('p', { class: 'muted' }, `The California return was held until the federal return was accepted (${held.map((s) => s.submission_id).join(', ')}).`) : null,
      resolvedBy
        ? h('p', { class: 'verified' }, `✓ Resubmitted and accepted · ${dayTime(resolvedBy.date)} · submission ${resolvedBy.submission_id}`)
        : h('p', { class: 'tag' }, 'Not resolved yet'),
    )),
  );
}

/** Assignments: a Reviewer or Partner hands a task on this number to someone, with an optional deadline. */
const STAFF = ['Preparer', 'Reviewer', 'Partner'];

function assignments(state, line, on) {
  if (!can(state.role, 'seepoints')) return ''; // internal to the firm, like review points
  const who = actor(state.index.packet, state.role);
  const pairs = assignmentsFor(state.events, line.key);
  const to = h('select', { id: 'assign-to', 'aria-label': 'Who the task is for' }, STAFF.map((r) => h('option', { value: r }, `For the ${r}`)));
  const due = h('input', { id: 'assign-due', type: 'date', 'aria-label': 'Deadline (optional)' });
  const text = h('input', { id: 'assign-text', type: 'text', placeholder: 'What needs doing?', 'aria-label': 'Task' });
  const add = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const t = text.value.trim();
      if (!t) return;
      const dueDate = due.value || null;
      text.value = '';
      due.value = '';
      on.add(newEvent({ claim: line.key, type: 'assign', by: { name: who.name, role: who.role }, to: to.value, due: dueDate, text: t }));
    },
  }, 'Assign');
  const doneButton = (a) => h('button', {
    type: 'button', class: 'btn',
    onClick: () => on.add(newEvent({ claim: line.key, type: 'done', closes: a.id, by: { name: who.name, role: who.role }, text: 'Done.' })),
  }, 'Mark done');
  return section('Assignments',
    pairs.length
      ? h('ul', { class: 'question-list' }, pairs.map(({ a, d }) => h('li', {},
          h('p', {}, h('strong', {}, a.text)),
          h('p', { class: 'muted' }, `For the ${a.to} · due ${dueDay(a.due)} · assigned by ${a.by.name} (${a.by.role})`),
          d
            ? h('p', { class: 'muted' }, `✓ Done by ${d.by.name} (${d.by.role}) · ${dayTime(d.at)}`)
            : [h('p', { class: 'tag' }, 'Open'), who.role === a.to ? doneButton(a) : h('p', { class: 'muted' }, `Waiting for the ${a.to}.`)],
        )))
      : h('p', { class: 'muted' }, 'No assignments on this number.'),
    can(state.role, 'assign') ? h('div', { class: 'row2' }, to, due) : null,
    can(state.role, 'assign') ? h('div', { class: 'row2' }, text, add) : null,
  );
}

/** Questions put to the client or a colleague. An answer attaches to its question and counts as evidence. */
function questions(state, line, on) {
  const who = actor(state.index.packet, state.role);
  const pairs = questionsFor(state.events, line.key);
  const to = h('select', { id: 'question-to', 'aria-label': 'Who the question is for' }, ASK_TO.map((r) => h('option', { value: r }, `For the ${r}`)));
  const text = h('input', { id: 'question-text', type: 'text', placeholder: 'Your question (required)', 'aria-label': 'Question' });
  const ask = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const q = text.value.trim();
      if (!q) return;
      text.value = '';
      on.add(newEvent({ claim: line.key, type: 'question', by: { name: who.name, role: who.role }, to: to.value, text: q }));
    },
  }, 'Ask');
  if (!can(state.role, 'ask')) { ask.setAttribute('disabled', ''); ask.setAttribute('title', WHY_NOT.ask); }

  const answerForm = (q) => {
    const box = h('input', { id: `answer-${q.id}`, type: 'text', placeholder: 'Your answer', 'aria-label': 'Answer' });
    const go = h('button', {
      type: 'button', class: 'btn',
      onClick: () => {
        const a = box.value.trim();
        if (!a) return;
        box.value = '';
        on.add(newEvent({ claim: line.key, type: 'answer', by: { name: who.name, role: who.role }, answers: q.id, text: a }));
      },
    }, 'Answer');
    // Not your turn: no box at all, just a note saying who the question is waiting on.
    if (!can(state.role, 'answer') || who.role !== q.to) {
      return h('p', { class: 'muted' }, `Waiting for the ${q.to} to answer.`);
    }
    return h('div', { class: 'row2' }, box, go);
  };

  const hidden = pairs.filter((p) => p.q.private).length; // questions between other people: only their existence is sent
  const readable = pairs.filter((p) => !p.q.private);
  return section('Questions',
    readable.length
      ? h('ul', { class: 'question-list' }, readable.map(({ q, a }) => h('li', {},
          h('p', {}, h('strong', {}, q.text)),
          h('p', { class: 'muted' }, `Asked by ${q.by.name} (${q.by.role}) for the ${q.to} · ${dayTime(q.at)}`),
          a
            ? h('div', { class: 'answer' },
                h('p', {}, a.text),
                h('p', { class: 'muted' }, `Answered by ${a.by.name} (${a.by.role}) · ${dayTime(a.at)} · counts as evidence`))
            : [h('p', { class: 'tag' }, 'Waiting for an answer'), answerForm(q)],
        )))
      : hidden ? null : h('p', { class: 'muted' }, 'No questions on this number.'),
    hidden ? h('p', { class: 'muted' }, `${hidden} private question${hidden === 1 ? '' : 's'} between other people.`) : null,
    h('div', { class: 'row2' }, to, text),
    h('div', { class: 'btns' }, ask),
  );
}

/** Who has opened this line. Only for the roles that may read the log (roles.js: 'viewlog'). */
function viewLog(state) {
  if (!can(state.role, 'viewlog')) return '';
  const mine = state.viewsFor?.key === state.key ? state.viewsFor.list : null;
  if (!mine) return '';
  const recent = [...mine].reverse().slice(0, 8);
  return section('Who has looked at this',
    recent.length
      ? h('ul', { class: 'view-log' }, recent.map((v) => h('li', { class: 'muted' }, `${v.by.name} (${v.by.role}) · ${dayTime(v.at)}`)))
      : h('p', { class: 'muted' }, 'No views recorded yet.'),
    mine.length > recent.length ? h('p', { class: 'muted' }, `Showing the latest ${recent.length} of ${mine.length} views.`) : null,
  );
}

/** Evidence a person added after the fact (an email, a call, a file). Saved as an 'evidence' event, never into the packet. */
function addedEvidence(notes, state, line, on) {
  const added = notes.filter((e) => e.type === 'evidence');
  const who = actor(state.index.packet, state.role);
  const what = h('input', { id: 'evidence-what', type: 'text', placeholder: 'What is it? (required)', 'aria-label': 'What the evidence is' });
  const where = h('input', { id: 'evidence-where', type: 'text', placeholder: 'Where to find it (optional)', 'aria-label': 'Where to find the evidence' });
  const file = h('input', { id: 'evidence-file', type: 'file', 'aria-label': 'Attach a file (optional)' });
  const message = h('p', { class: 'muted', id: 'evidence-msg' });
  const add = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const text = what.value.trim();
      if (!text) { message.textContent = 'Say what the evidence is.'; return; }
      const picked = file.files?.[0];
      const whereText = where.value.trim() || null;
      const fileInfo = picked ? { name: picked.name, size: picked.size } : null; // the name only: the file itself is not stored
      what.value = '';
      where.value = '';
      file.value = '';
      on.add(newEvent({ claim: line.key, type: 'evidence', by: { name: who.name, role: who.role }, text, where: whereText, file: fileInfo }));
    },
  }, 'Add evidence');
  if (!can(state.role, 'evidence')) {
    add.setAttribute('disabled', '');
    add.setAttribute('title', WHY_NOT.evidence);
  }
  return h('div', { class: 'added-evidence' },
    h('h3', {}, 'Added by the team'),
    added.length
      ? h('ul', { class: 'added-list' }, added.map((e) => h('li', {},
          h('p', {}, h('strong', {}, e.text)),
          e.where ? h('p', { class: 'muted' }, `Where: ${e.where}`) : null,
          e.file ? h('p', { class: 'muted' }, `File: ${e.file.name} (${Math.max(1, Math.round(e.file.size / 1024))} KB). Only the name is recorded, not the file.`) : null,
          h('p', { class: 'muted' }, `Added by ${e.by.name} (${e.by.role}) · ${dayTime(e.at)}`),
        )))
      : h('p', { class: 'muted' }, 'Nothing added yet.'),
    h('div', { class: 'row2' }, what, where),
    file, message, h('div', { class: 'btns' }, add),
  );
}

/** Last year's number for this line, and other lines built on the same evidence. Hidden when there is neither. */
function related(trace, state, on) {
  const { lastYear, sharedWith } = trace;
  if (!lastYear && !sharedWith.length) return '';
  const shown = sharedWith.slice(0, 8);
  return section('Related',
    lastYear
      ? h('p', { class: 'rule' }, 'Last year (2024) this line was ', h('strong', {}, num(lastYear.value)),
          typeof trace.line.value === 'number' ? ` — ${signed(trace.line.value - lastYear.value)} this year.` : '.')
      : null,
    shown.length
      ? h('div', {},
          h('p', { class: 'muted' }, 'Other lines that use the same evidence:'),
          h('ul', { class: 'links' }, shown.map((hit) => linkRow(hit.line, state, on))),
          sharedWith.length > shown.length ? h('p', { class: 'muted' }, `and ${sharedWith.length - shown.length} more.`) : null)
      : null,
  );
}

/** Build one section; if it throws, show why in its place instead of leaving the whole column blank. */
const safe = (name, build) => {
  try { return build(); } catch (err) {
    return h('section', { class: 'block' }, h('h2', {}, name), h('p', { class: 'muted' }, `This part could not be drawn: ${err.message}`));
  }
};

const section = (title, ...children) => h('section', { class: 'block' }, h('h2', {}, title), children);
const pill = (status, text) => h('span', { class: `pill p-${status}` }, h('span', { 'aria-hidden': 'true' }, GLYPH[status]), ` ${text}`);

function linkRow(line, state, on) {
  const status = state.statusByKey.get(line.key) ?? 'na';
  return h('li', {},
    h('button', { type: 'button', class: 'link-row', onClick: () => on.select(line.key) },
      h('span', { class: `glyph s-${status}`, 'aria-hidden': 'true' }, GLYPH[status]),
      h('span', { class: 'link-label' }, line.label, h('span', { class: 'row-key' }, ` ${line.key}`)),
      h('span', { class: 'row-value' }, typeof line.value === 'number' ? num(line.value) : String(line.value)),
    ),
  );
}

function sourceRow(source, state, on) {
  const open = () => on.source(source.ref);
  const selected = state.sourceRef === source.ref;
  let title = source.ref;
  let detail = '';
  if (source.kind === 'value' && source.value) {
    title = `${source.doc.id} · ${source.value.label}`;
    detail = `${source.doc.title} · page ${source.value.page} · read as ${source.value.text_as_read || '(blank)'}`;
  } else if (source.kind === 'client') {
    title = `${source.type} ${source.item?.id ?? source.ref}`;
    detail = source.item?.answer ?? source.item?.text ?? '';
  } else if (source.kind === 'prior') {
    title = 'Last year’s return';
    detail = source.pointer;
  } else if (source.kind === 'param') {
    title = `Engine parameter ${source.name}`;
  } else if (source.kind === 'unread') {
    title = `${source.doc?.id} page ${source.page}`;
    detail = 'Never read by the pipeline';
  } else {
    title = source.ref;
  }
  return h('li', {},
    h('button', { type: 'button', class: `source-row${selected ? ' is-selected' : ''}`, onClick: open },
      h('span', { class: 'source-title' }, title),
      h('span', { class: 'source-detail' }, detail),
      source.kind === 'value' && source.value ? h('span', { class: 'row-value' }, num(source.value.value)) : null,
    ),
  );
}

/** Problems first (fail, then warn, then waiting-for-verification); passed checks folded under one line. */
function checkList(checks, state, line, on) {
  const shown = checks.filter((c) => c.status !== 'na');
  const waiting = (c) => c.verify && !verifiedBy(c, state, line);
  const rank = (c) => (c.status === 'fail' ? 0 : c.status === 'warn' ? 1 : 2);
  const attention = shown.filter((c) => c.status !== 'pass' || waiting(c)).sort((a, b) => rank(a) - rank(b));
  const passed = shown.filter((c) => !attention.includes(c));
  const rows = (list) => h('ul', { class: 'checks' }, list.map((c) => checkRow(c, state, line, on)));
  return h('div', { class: 'check-list' },
    attention.length ? rows(attention) : null,
    passed.length
      ? h('details', { class: 'passed', open: state.passedOpen, onToggle: (e) => on.passed(e.target.open) },
          h('summary', {}, `${passed.length} check${passed.length === 1 ? '' : 's'} passed`),
          rows(passed))
      : null,
  );
}

function checkRow(check, state, line, on) {
  // A check that asks for a person's confirmation only gets its green tick once someone has confirmed it.
  const waiting = check.verify && !verifiedBy(check, state, line);
  const shown = waiting ? 'warn' : check.status;
  return h('li', { class: `check c-${shown}` },
    h('span', { class: `glyph s-${shown}`, 'aria-hidden': 'true' }, GLYPH[shown]),
    h('div', {},
      h('p', { class: 'check-title' }, check.label, waiting ? ' — Waiting for verification' : ` — ${LABEL[check.status]}`),
      h('p', { class: 'check-detail' }, check.detail),
      (check.refs ?? (check.ref ? [check.ref] : [])).map((ref) => h('button', { type: 'button', class: 'linkish', onClick: () => on.source(ref) }, `Show ${ref}`)),
      check.verify ? verifyBlock(check, state, line, on) : null,
    ),
  );
}

const verifiedBy = (check, state, line) => verifiedEvent(state.events, line.key, check.verifyKey);

/** A passing check that still wants a person's confirmation. Saved as a 'verify' event. */
function verifyBlock(check, state, line, on) {
  const done = verifiedBy(check, state, line);
  if (done) return h('p', { class: 'verified' }, `✓ Verified by ${done.by.name} (${done.by.role}) · ${dayTime(done.at)}`);
  const who = actor(state.index.packet, state.role);
  const button = h('button', {
    type: 'button', class: 'btn',
    onClick: () => on.add(newEvent({ claim: line.key, type: 'verify', check: check.verifyKey, by: { name: who.name, role: who.role }, text: 'Confirmed the copy is counted once.' })),
  }, 'Mark verified');
  if (!can(state.role, 'verify')) {
    button.setAttribute('disabled', '');
    button.setAttribute('title', WHY_NOT.verify);
  }
  return h('div', { class: 'verify' }, h('span', { class: 'tag' }, 'Needs verification'), button);
}

// ---------- actions (enforced by role) ----------

function actions(state, line, value, checks, on) {
  const who = actor(state.index.packet, state.role);
  const gate = (action, node) => {
    if (can(state.role, action)) return node;
    node.setAttribute('disabled', '');
    node.setAttribute('title', WHY_NOT[action]);
    return node;
  };

  const noteBox = h('textarea', { id: 'note-text', rows: '2', placeholder: 'Write a note or a question for the file', 'aria-label': 'Note text' });
  const addNote = gate('note', h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const text = noteBox.value.trim();
      if (!text) return;
      noteBox.value = '';
      on.add(newEvent({ claim: line.key, type: 'note', by: { name: who.name, role: who.role }, text }));
    },
  }, 'Add note'));

  const newValue = h('input', { id: 'adjust-value', type: 'number', step: 'any', placeholder: `New value (now ${num(value)})`, 'aria-label': 'New value' });
  const reason = h('input', { id: 'adjust-reason', type: 'text', placeholder: 'Why (required)', 'aria-label': 'Reason for the change' });
  const preview = h('p', { class: 'muted', id: 'adjust-preview' });
  const update = () => {
    const to = Number(newValue.value);
    if (newValue.value === '' || Number.isNaN(to)) { preview.textContent = ''; return; }
    const effect = taxEffect(state.index.current, line.key, to - value);
    preview.textContent = effect
      ? `Estimated tax effect: federal ${signed(effect.federal)}, California ${signed(effect.california)} (change × the packet’s ${effect.category} rate).`
      : 'No rate is mapped for this line, so no tax effect is shown.';
  };
  newValue.addEventListener('input', update);
  const adjust = gate('adjust', h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const to = Number(newValue.value);
      if (newValue.value === '' || Number.isNaN(to) || !reason.value.trim()) {
        preview.textContent = 'Enter a new value and a reason.';
        return;
      }
      const why = reason.value.trim();
      newValue.value = '';
      reason.value = '';
      preview.textContent = '';
      on.add(newEvent({
        claim: line.key, type: 'adjust', by: { name: who.name, role: who.role },
        from: value, to, text: why, taxEffect: taxEffect(state.index.current, line.key, to - value),
      }));
    },
  }, 'Adjust number'));

  const alreadySigned = signoffState(line, state.events).state === 'signed';
  const blocked = alreadySigned
    ? 'Already signed off at this value. It can be signed again after the value changes.'
    : needsPartner(state.events, line.key) && state.role !== 'partner'
      ? `This adjustment has a tax effect over ${num(PARTNER_OVER)}. Only the Partner can sign it off.`
      : signoffBlocker(checks, state.events, line.key); // a sentence saying why, or null
  const signButton = gate('signoff', h('button', {
    type: 'button', class: 'btn btn-primary',
    onClick: () => {
      if (blocked) return;
      on.add(newEvent({ claim: line.key, type: 'signoff', by: { name: who.name, role: who.role }, valueAtSignoff: value }));
    },
  }, 'Sign off'));
  if (blocked && can(state.role, 'signoff')) {
    signButton.setAttribute('disabled', '');
    signButton.setAttribute('title', blocked);
  }

  const revert = value !== line.value && can(state.role, 'adjust') && !filedEvent(state.events)
    ? h('button', {
        type: 'button', class: 'btn btn-quiet',
        onClick: () => on.add(newEvent({ claim: line.key, type: 'revert', by: { name: who.name, role: who.role }, from: value, to: line.value, text: 'Reverted to the engine value.' })),
      }, 'Revert to engine value')
    : null;

  return h('div', { class: 'actions' },
    h('div', { class: 'action' }, noteBox, addNote),
    filedEvent(state.events) ? amendAction(state, line, value, who, gate, on) : h('div', { class: 'action' }, h('div', { class: 'row2' }, newValue, reason),
      h('p', { class: 'muted' }, 'This changes this line only. Lines that use it are not recalculated.'),
      preview, h('div', { class: 'btns' }, adjust, revert)),
    h('div', { class: 'action' }, signButton,
      blocked && can(state.role, 'signoff') ? h('span', { class: 'muted' }, ` ${blocked}`) : null),
  );
}

function history(events) {
  if (!events.length) return h('p', { class: 'muted' }, 'Nothing recorded on this number yet.');
  return h('ol', { class: 'history' },
    [...events].reverse().map((e) => {
      const what = EVENT_LABEL[e.type];
      return h('li', {},
        h('p', { class: 'hist-head' }, h('strong', {}, what), ` · ${e.by.name} (${e.by.role}) · ${dayTime(e.at)}`),
        e.type === 'adjust' || e.type === 'revert' || e.type === 'amend' ? h('p', {}, `${num(e.from)} → ${num(e.to)}`) : null,
        e.type === 'signoff' ? h('p', {}, `Covers the value ${num(e.valueAtSignoff)}.`) : null,
        e.type === 'decision' ? h('p', {}, `${DECISION_LABEL[e.category] ?? e.category} · authority: ${e.authority}`) : null,
        e.swing ? h('p', { class: 'muted' }, 'Explains the change against last year.') : null,
        e.text ? h('p', { class: 'hist-text' }, e.text) : null,
        e.taxEffect ? h('p', { class: 'muted' }, `Estimated tax effect: federal ${signed(e.taxEffect.federal)}, California ${signed(e.taxEffect.california)}.`) : null,
      );
    }),
  );
}

/** After filing the adjust form is replaced by this one: the filed number stays, the amendment sits on top. */
function amendAction(state, line, value, who, gate, on) {
  const amendValue = h('input', { id: 'amend-value', type: 'number', step: 'any', placeholder: `Amended value (now ${num(value)})`, 'aria-label': 'Amended value' });
  const amendReason = h('input', { id: 'amend-reason', type: 'text', placeholder: 'Why (at least 15 characters)', 'aria-label': 'Reason for the amendment' });
  const msg = h('p', { class: 'muted', id: 'amend-preview' });
  const go = gate('amend', h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      const to = Number(amendValue.value);
      const why = amendReason.value.trim();
      if (amendValue.value === '' || Number.isNaN(to) || why.length < 15) { msg.textContent = 'Enter an amended value and a reason of at least 15 characters.'; return; }
      amendValue.value = '';
      amendReason.value = '';
      on.add(newEvent({
        claim: line.key, type: 'amend', by: { name: who.name, role: who.role },
        from: value, to, text: why, taxEffect: taxEffect(state.index.current, line.key, to - value),
      }));
    },
  }, 'Amend filed number'));
  return h('div', { class: 'action' }, h('div', { class: 'row2' }, amendValue, amendReason),
    h('p', { class: 'muted' }, 'The return is filed and frozen. This does not change the filed number: it adds an amendment on top.'),
    msg, h('div', { class: 'btns' }, go));
}

// ---------- judgment (J1 swing explanation, J2 recorded judgments) ----------

function judgment(state, line, on) {
  if (!can(state.role, 'seepoints')) return ''; // internal to the firm
  const who = actor(state.index.packet, state.role);
  const flag = varianceFlags(state.index, state.events).find((f) => f.key === line.key);
  const explained = swingNoteFor(state.events, line.key);
  const decisions = eventsFor(state.events, line.key).filter((e) => e.type === 'decision');

  // J1: a big move against last year needs a written reason
  let swing = null;
  if (flag) {
    const why = h('textarea', { rows: '2', placeholder: 'Why did this move? (at least 15 characters)', 'aria-label': 'Why it moved' });
    const msg = h('p', { class: 'muted' });
    const go = h('button', {
      type: 'button', class: 'btn',
      onClick: () => {
        const t = why.value.trim();
        if (t.length < 15) { msg.textContent = 'Write at least 15 characters.'; return; }
        on.add(newEvent({ claim: line.key, type: 'note', swing: true, by: { name: who.name, role: who.role }, text: t }));
      },
    }, 'Explain the change');
    if (!can(state.role, 'note')) { go.setAttribute('disabled', ''); go.setAttribute('title', WHY_NOT.note); why.setAttribute('disabled', ''); }
    swing = h('div', { class: 'action swing' },
      h('p', {}, h('strong', {}, 'Moved against last year. '), `${num(flag.last)} → ${num(flag.now)} (${signed(flag.change)}${flag.pct === null ? ', from zero' : `, ${Math.round(flag.pct)}%`}). The firm asks for a reason when a number moves over 10% and over 1,000.`),
      explained
        ? h('p', { class: 'hist-text' }, h('strong', {}, 'Explained: '), explained.text, ` (${explained.by.name})`)
        : h('div', {}, why, go, msg));
  }

  // J2: write the judgment down with the authority it rests on
  const kind = h('select', { 'aria-label': 'Kind of judgment' }, Object.entries(DECISION_LABEL).map(([v, t]) => h('option', { value: v }, t)));
  const text = h('input', { type: 'text', placeholder: 'What was decided', 'aria-label': 'What was decided' });
  const authority = h('input', { type: 'text', placeholder: 'Authority relied on (Code section, form instruction, client document)', 'aria-label': 'Authority' });
  const msg = h('p', { class: 'muted' });
  const save = h('button', {
    type: 'button', class: 'btn',
    onClick: () => {
      if (text.value.trim().length < 15 || authority.value.trim().length < 3) { msg.textContent = 'Say what was decided (15+ characters) and name the authority.'; return; }
      on.add(newEvent({ claim: line.key, type: 'decision', category: kind.value, by: { name: who.name, role: who.role }, text: text.value.trim(), authority: authority.value.trim() }));
    },
  }, 'Record judgment');
  if (!can(state.role, 'decide')) { save.setAttribute('disabled', ''); save.setAttribute('title', WHY_NOT.decide); }

  return h('div', { class: 'actions' },
    swing,
    decisions.length ? h('ul', { class: 'std-flags' }, decisions.map((d) => h('li', {}, h('strong', {}, `${DECISION_LABEL[d.category] ?? d.category}: `), d.text, ` — authority: ${d.authority} (${d.by.name})`))) : null,
    h('div', { class: 'action' }, h('p', { class: 'muted' }, 'An election, due diligence, a penalty or any call you made. Write what you decided and what it rests on.'),
      h('div', { class: 'row2' }, kind, text), authority, h('div', { class: 'btns' }, save), msg));
}

/** b15: on the line itself, what the engine changed in the latest version (old and new value). */
function changeNote(index, line) {
  const change = (index.current.changes_from_previous ?? []).find((c) => c.key === line.key);
  if (!change) return null;
  const v = index.versions[index.versions.length - 2]?.version ?? 'the last version';
  const text = change.change === 'added' ? `Added in ${index.current.version}: ${num(change.new)}.`
    : change.change === 'removed' ? `Removed in ${index.current.version}.`
    : `Changed since ${v}: ${num(change.old)} → ${num(change.new)}.`;
  return h('p', { class: 'engine-note' }, h('strong', {}, 'Version change '), text);
}

// ---------- what-ifs (Ch3): never saved ----------

function tryBanner(state, on) {
  if (!state.tryIt.size) return null;
  const t = tryTotals(state);
  return h('div', { class: 'tryit-banner', role: 'status' },
    h('strong', {}, 'What-if mode. '), `${t.tried} number${t.tried === 1 ? '' : 's'} tried; nothing is saved and a reload clears it. `,
    t.mapped ? `Estimated tax effect of all of them: federal ${signed(Math.round(t.federal))}, California ${signed(Math.round(t.california))}.` : 'None of them has a tax rate in the packet, so no tax effect is shown.',
    h('button', { type: 'button', class: 'linkish', onClick: () => on.tryClear() }, 'Stop trying everything'));
}

function tryItSection(state, line, value, on) {
  if (!can(state.role, 'seepoints')) return '';
  const tried = state.tryIt.get(line.key);
  const input = h('input', { id: 'try-value', type: 'number', step: 'any', placeholder: `Try a value (now ${num(value)})`, 'aria-label': 'Try a value', value: tried ?? '' });
  const preview = h('p', { class: 'muted' });
  const show = () => {
    const to = Number(input.value);
    if (input.value === '' || Number.isNaN(to)) { preview.textContent = ''; return; }
    const fx = taxEffect(state.index.current, line.key, to - value);
    preview.textContent = fx ? `If it were ${num(to)}: federal ${signed(fx.federal)}, California ${signed(fx.california)} (estimated, not saved).` : `If it were ${num(to)}: no tax rate is mapped for this line, so no tax effect is shown.`;
  };
  input.addEventListener('input', show);
  show();
  const go = h('button', { type: 'button', class: 'btn', onClick: () => { const to = Number(input.value); if (input.value !== '' && !Number.isNaN(to)) on.tryIt(line.key, to); } }, 'Try it');
  const stop = tried !== undefined ? h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => on.tryIt(line.key, null) }, 'Stop trying this one') : null;
  return h('div', { class: 'action' },
    h('p', { class: 'muted' }, 'Test a different number without changing anything. Nothing is saved, no sign-off reopens, and a reload clears it.'),
    h('div', { class: 'row2' }, input, go), preview, stop);
}
