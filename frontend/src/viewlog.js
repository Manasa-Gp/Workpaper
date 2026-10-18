// viewlog.js — the record of who opened which line or evidence item.
//
// Called by: main.js (records a view whenever someone opens something) and
//            views/claim.js (shows the log to the roles allowed to see it).
// Storage:   the backend only (POST/GET /api/views -> backend/data/views.json).
//
// Recording never blocks the page: if the server cannot be reached the view is simply not logged.

/** Tell the server that `who` opened `target`. kind is 'line' (a number) or 'source' (evidence). */
export async function recordView(target, kind, who) {
  try {
    await fetch('/api/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, kind, by: { name: who.name, role: who.role } }),
    });
  } catch { /* the log is best-effort in the demo */ }
}

/** The views of one target, oldest first. Empty if this role may not read the log or the server is down. */
export async function loadViews(target, role) {
  try {
    const query = new URLSearchParams({ target, role });
    const response = await fetch(`/api/views?${query}`);
    return response.ok ? response.json() : [];
  } catch {
    return [];
  }
}
