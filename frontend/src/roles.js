// roles.js — who can do what. The role switcher in views/topbar.js reads this.
//
// Roles are enforced in views/claim.js: a button for an action the current role
// does not have is disabled and says why. Names come from packet.firm.staff.

export const ROLES = {
  preparer: { label: 'Preparer', staffId: 'st-01', can: ['note', 'adjust', 'amend', 'evidence', 'ask', 'answer', 'seepoints', 'done'] },
  // A second preparer the firm has NOT cleared for sensitive data (packet: Marcus Bell, st-04). Same work, but no Reveal.
  preparer2: { label: 'Preparer', staffId: 'st-04', can: ['note', 'adjust', 'amend', 'evidence', 'ask', 'answer', 'seepoints', 'done'] },
  reviewer: { label: 'Reviewer', staffId: 'st-02', can: ['note', 'evidence', 'ask', 'answer', 'verify', 'signoff', 'viewlog', 'block', 'clear', 'seepoints', 'assign', 'done', 'present'] },
  partner: { label: 'Partner', staffId: 'st-03', can: ['note', 'evidence', 'ask', 'answer', 'verify', 'signoff', 'viewlog', 'block', 'clear', 'seepoints', 'assign', 'done', 'present', 'file'] },
  client: { label: 'Client', staffId: null, can: ['answer', 'approve'] },
  admin: { label: 'Administrator', staffId: 'st-05', can: ['reset', 'viewlog'] },
};

export function actor(packet, roleKey) {
  const role = ROLES[roleKey];
  let name = role.label;
  if (role.staffId) {
    name = packet.firm.staff.find((s) => s.id === role.staffId)?.name ?? name;
  } else if (roleKey === 'client') {
    name = packet.household.people[0]?.name ?? name;
  }
  return { roleKey, role: role.label, name };
}

export const can = (roleKey, action) => ROLES[roleKey].can.includes(action);

/**
 * May this role reveal sensitive numbers (SSNs, PINs, bank numbers)? Only staff the firm has cleared
 * (sensitive_data_clearance in the packet). The client is not staff, so has no clearance to reveal with.
 */
export function canSeeSensitive(packet, roleKey) {
  const role = ROLES[roleKey];
  if (!role.staffId) return false;
  return packet.firm.staff.find((s) => s.id === role.staffId)?.sensitive_data_clearance === true;
}

export const WHY_NOT = {
  note: 'Your role cannot add notes.',
  evidence: 'Only the firm’s staff can add evidence.',
  ask: 'Only the firm’s staff can ask a question.',
  answer: 'This question is for someone else.',
  adjust: 'Only a preparer can adjust a number.',
  verify: 'Only a reviewer or partner can verify a flagged check.',
  signoff: 'Only a reviewer or partner can sign off.',
  block: 'Only a reviewer or partner can raise a review point.',
  clear: 'Only a reviewer or partner can clear a review point.',
  assign: 'Only a reviewer or partner can assign work.',
  done: 'This task is for someone else.',
  present: 'Only a reviewer or partner can present the return for approval.',
  approve: 'Only the client approves and signs the return.',
  file: 'Only the partner marks the return as filed.',
  amend: 'Only a preparer can amend a filed number.',
  reset: 'Only the administrator can reset saved work.',
};
