// views/approval.js — the whole return's approval: present it, the client approves and e-signs it.
//
// Called by: views/picker.js (left column, under "My work").
// Reads:     approvalState() and returnFingerprint() (events.js), roles.js.
// Calls back: on.add(event) to save a 'present' or 'approve' event (key RETURN).
//
// The rule that matters: the client signs a fingerprint of every number. If any number changes after
// that, the fingerprint no longer matches and the signatures are shown as out of date.

import { h } from '../dom.js';
import { actor, can, WHY_NOT } from '../roles.js';
import { allOpenReviewPoints, approvalState, newEvent, returnFingerprint, signersOf, RETURN_KEY } from '../events.js';
import { dayTime } from '../format.js';

const WORDS = {
  none: 'Draft. Not yet presented to the client.',
  presented: 'Waiting for the client to approve and sign.',
  partly: 'Partly signed. Waiting for the other signer.',
  approved: 'Approved and signed by everyone. Ready to file.',
  stale: 'Out of date. A number changed after the return was presented.',
};

export function approval(state, on) {
  const who = actor(state.index.packet, state.role);
  const signers = signersOf(state.index.packet);
  const fingerprint = returnFingerprint(state.index.current.lines, state.events);
  const now = approvalState(state.events, fingerprint, signers);
  const open = allOpenReviewPoints(state.events).length;

  const present = h('button', {
    type: 'button', class: 'btn btn-primary',
    onClick: () => on.add(newEvent({ claim: RETURN_KEY, type: 'present', by: { name: who.name, role: who.role }, fingerprint, text: 'Presented the return for approval.' })),
  }, now.state === 'none' ? 'Present for approval' : 'Present again');
  let blocked = null;
  if (open) blocked = `${open} review point${open === 1 ? ' is' : 's are'} still open.`;
  else if (now.state === 'presented' || now.state === 'partly' || now.state === 'approved') blocked = 'Already presented at these numbers.';
  if (!can(state.role, 'present')) { present.setAttribute('disabled', ''); present.setAttribute('title', WHY_NOT.present); }
  else if (blocked) { present.setAttribute('disabled', ''); present.setAttribute('title', blocked); }

  const signRow = (name) => {
    const typed = h('input', { type: 'text', placeholder: `Type "${name}" to sign`, 'aria-label': `Signature of ${name}` });
    const go = h('button', {
      type: 'button', class: 'btn',
      onClick: () => {
        const signature = typed.value.trim();
        if (!signature) return;
        typed.value = '';
        on.add(newEvent({
          claim: RETURN_KEY, type: 'approve', by: { name: who.name, role: who.role },
          presents: now.present.id, fingerprint, signer: name, signature,
          text: 'Approved the return and e-signed Form 8879 (federal) and FTB 8879 (California).',
        }));
      },
    }, 'Approve and e-sign');
    return h('div', { class: 'sign-row' }, h('p', { class: 'sign-name' }, name), h('div', { class: 'sign-fields' }, typed, go));
  };
  const canSign = can(state.role, 'approve') && (now.state === 'presented' || now.state === 'partly');

  return h('details', { class: 'approval', open: true },
    h('summary', {}, 'Return approval ', h('span', { class: `pill ${now.state === 'approved' ? 'p-pass' : now.state === 'stale' ? 'p-fail' : 'p-info'}` }, now.state === 'none' ? 'Draft' : now.state === 'stale' ? 'Out of date' : now.state === 'approved' ? 'Approved' : 'Presented')),
    h('p', {}, WORDS[now.state]),
    now.present ? h('p', { class: 'muted' }, `Presented by ${now.present.by.name} (${now.present.by.role}) · ${dayTime(now.present.at)}`) : null,
    now.signed.map((e) => h('p', { class: 'muted' }, `✓ ${e.signer} signed · ${dayTime(e.at)}${now.state === 'stale' ? ' (no longer covers the current numbers)' : ''}`)),
    canSign ? now.missing.map(signRow) : null,
    state.role === 'client' && now.state === 'none' ? h('p', { class: 'muted' }, 'Your accountant has not sent the return for your approval yet.') : null,
    can(state.role, 'present') ? present : null,
    can(state.role, 'present') && blocked ? h('p', { class: 'muted' }, blocked) : null,
  );
}
