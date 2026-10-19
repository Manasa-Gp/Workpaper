// serverchecks.js — the screen asks the server for the checks and only displays the answer.
// The rules live in backend/checks.py. If the server cannot be reached (for example the packet was
// chosen from a file), or its answer is for an older value than the one on screen, the old in-browser
// rules in checks.js and crosschecks.js fill in until the next answer arrives.

import { claimChecks } from './checks.js';
import { crossChecks, incomeByCategory } from './crosschecks.js';

export async function loadChecks() {
  const res = await fetch('/api/checks');
  if (!res.ok) throw new Error('no checks');
  return res.json();
}

/** The checks for one claim at the number now on screen. */
export function checksFor(state, trace, value) {
  const server = state.serverChecks?.claims[trace.line.key];
  if (server && server.value === value) return server.checks;
  return claimChecks(state.index, trace, value);
}

/** Cross-checks against agencies and documents (for the Records pages). */
export function crossFor(state) {
  return state.serverChecks?.cross ?? crossChecks(state.index);
}

/** Income by category, federal / California law / California / outside California. */
export function incomeFor(state) {
  return state.serverChecks?.income ?? incomeByCategory(state.index);
}
