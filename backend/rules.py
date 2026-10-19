"""rules.py - the server's own copy of "who may do what".

The browser already greys out buttons (frontend/src/roles.js). That only protects people who
use the buttons. The server runs these same rules on every event it is sent, so a request
that skips the page is refused too.

Keep this list in step with ROLES in frontend/src/roles.js.

Honest limit: the demo has no login. The server believes the role written in the event
("by.role"). It stops a role from doing what it is not allowed to, but it cannot prove
who is really sending. A real version would check a signed-in user instead.
"""

import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path

# role label (as written in event["by"]["role"]) -> event types that role may add
ALLOWED = {
    "Preparer": {"note", "adjust", "revert", "evidence", "question", "answer", "done", "amend", "time", "decision", "undo"},
    "Reviewer": {"note", "evidence", "verify", "signoff", "question", "answer", "block", "clear", "assign", "done", "present", "time", "decision", "undo"},
    "Partner": {"note", "evidence", "verify", "signoff", "question", "answer", "block", "clear", "assign", "done", "present", "file", "time", "decision", "undo"},
    "Quality reviewer": set(),  # reads everything, changes nothing (the packet has them join on 2027-01-04)
    "Client": {"answer", "approve"},  # the client answers questions and approves/signs the return; nothing else
    "Administrator": set(),
}


def check_event(event, events=()):
    """Return None if the event is allowed, otherwise a plain sentence saying why not.

    `events` is the list already saved, used for rules that look at history.
    """
    by = event.get("by")
    role = by.get("role") if isinstance(by, dict) else None
    kind = event.get("type")
    if role not in ALLOWED:
        return f"Unknown role: {role!r}."
    if kind not in {t for types in ALLOWED.values() for t in types}:
        return f"Unknown event type: {kind!r}."
    if kind not in ALLOWED[role]:
        return f"A {role} may not add a '{kind}' event."
    if kind == "time":
        return _check_time(event)
    if kind == "decision":
        return _check_decision(event)
    if kind == "undo":
        return _check_undo(event, events)
    if kind == "note" and event.get("swing") and len(str(event.get("text", "")).strip()) < 15:
        return "An explanation of a change against last year needs at least 15 characters."
    if kind == "file":
        return _check_file(event, events)
    if kind == "amend":
        return _check_amend(event, events)
    if kind in FROZEN_KINDS and filed_event(events):
        return f"The return is filed and frozen. A '{kind}' event is no longer allowed; amend the line instead."
    if kind == "question" and event.get("to") not in ("Client", "Preparer", "Reviewer", "Partner"):
        return "A question must say who it is for."
    if kind == "answer":
        return _check_answer(event, events, role)
    if kind == "block" and not str(event.get("text", "")).strip():
        return "A review point must say what is wrong."
    if kind == "clear":
        return _check_clear(event, events)
    if kind == "present":
        return _check_present(event, events)
    if kind == "approve":
        return _check_approve(event, events)
    if kind == "assign":
        return _check_assign(event)
    if kind == "done":
        return _check_done(event, events, role)
    if kind == "signoff":
        if filed_event(events) and not any(e.get("type") == "amend" and e.get("claim") == event.get("claim") for e in events):
            return "The return is filed and frozen. Only a line that has been amended can be signed off."
        if role != "Partner" and needs_partner(events, event.get("claim")):
            return f"This adjustment has a tax effect over {PARTNER_OVER:,}. Only the Partner can sign it off."
        if open_blocks(events, event.get("claim")):
            return "This line has open review points. Clear them before signing off."
        if _already_signed(event, events):
            return "This line is already signed off at this value. It can be signed again only after the value changes."
    return None


PARTNER_OVER = 1000  # firm standard: an adjustment with a tax effect over this (federal or California) needs the Partner


def needs_partner(events, claim):
    """True if the line's latest change is an adjustment whose estimated tax effect is over PARTNER_OVER."""
    changes = [e for e in events if e.get("claim") == claim and e.get("type") in ("adjust", "revert", "amend")]
    if not changes or changes[-1].get("type") != "adjust":
        return False
    effect = changes[-1].get("taxEffect")
    if not isinstance(effect, dict):
        return False
    amounts = [abs(effect[k]) for k in ("federal", "california") if _is_number(effect.get(k))]
    return bool(amounts) and max(amounts) > PARTNER_OVER


# ---- time against budget ----------------------------------------------------------------------
# A 'time' event says how many hours someone spent on one area of the work. The areas and their
# budgets come from the packet (firm.budget_hours), so the server refuses an area it does not know.

MAX_HOURS = 24


@lru_cache(maxsize=1)
def budget_areas():
    try:
        with open(Path(__file__).resolve().parent / "data" / "packet.json", encoding="utf-8") as f:
            return tuple(json.load(f)["firm"]["budget_hours"].keys())
    except (OSError, ValueError, KeyError):
        return ()


def _check_time(event):
    if event.get("area") not in budget_areas():
        return "Time must be recorded against one of the budget areas."
    hours = event.get("hours")
    if not _is_number(hours) or not (0 < hours <= MAX_HOURS):
        return f"Hours must be a number above 0 and at most {MAX_HOURS}."
    return None


# A 'decision' is a judgment call written down with the authority it rests on (J2).
DECISION_KINDS = ("election", "due_diligence", "penalty", "judgment")


def _check_decision(event):
    if event.get("category") not in DECISION_KINDS:
        return "A decision must be an election, due diligence, a penalty or a judgment."
    if len(str(event.get("text", "")).strip()) < 15:
        return "Say what was decided (at least 15 characters)."
    if len(str(event.get("authority", "")).strip()) < 3:
        return "Name the authority relied on (a Code section, a form instruction, or the client's document)."
    return None


def undone_batches(events):
    return {e.get("batch") for e in events if e.get("type") == "undo"}


def _check_undo(event, events):
    """Ch4: only the newest batch still showing can be taken back, and only once."""
    batch = event.get("batch")
    live = [e for e in events if e.get("batch") and e.get("type") != "undo" and e.get("batch") not in undone_batches(events)]
    if not batch or not live:
        return "There is no batch to undo."
    if live[-1]["batch"] != batch:
        return "Only the latest batch can be undone."
    return None


def open_blocks(events, claim):
    """Review points ('block' events) on a line that no 'clear' event has closed yet."""
    cleared = {e.get("clears") for e in events if e.get("type") == "clear"}
    return [e for e in events if e.get("type") == "block" and e.get("claim") == claim and e.get("id") not in cleared]


STAFF_ROLES = ("Preparer", "Reviewer", "Partner")

# ---- presenting the return and the client's approval (Form 8879) ----------------------------
# "Present" freezes a fingerprint of every number on the return. The client then approves THAT
# fingerprint, once per signer (taxpayer and spouse). If a number changes afterwards the
# fingerprint no longer matches and the page shows the approval as out of date.

@lru_cache(maxsize=1)
def signers():
    """Names of the people who must sign a joint return: the taxpayer and the spouse in the packet."""
    try:
        with open(Path(__file__).resolve().parent / "data" / "packet.json", encoding="utf-8") as f:
            people = json.load(f)["household"]["people"]
        return tuple(p["name"] for p in people if p.get("role") in ("taxpayer", "spouse"))
    except (OSError, ValueError, KeyError):
        return ()


def _latest(events, kind):
    found = [e for e in events if e.get("type") == kind]
    return found[-1] if found else None


# ---- freeze at filing, amend on top ---------------------------------------------------------
# The Partner's 'file' event keeps a snapshot of every number and the fingerprint the client signed.
# From then on the numbers cannot be adjusted, reverted, presented or signed again. A change is an
# 'amend' event layered on top; the snapshot in the 'file' event is never touched.

FROZEN_KINDS = ("adjust", "revert", "present", "approve")
MIN_REASON = 15
MAX_SNAPSHOT = 5000


def filed_event(events):
    """The 'file' event, or None while the return is still open."""
    return _latest(events, "file")


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _check_file(event, events):
    if filed_event(events):
        return "The return is already filed."
    fingerprint = event.get("fingerprint")
    if not isinstance(fingerprint, str) or not fingerprint or len(fingerprint) > 64:
        return "Filing needs the fingerprint of the return."
    if any(e.get("type") == "block" for e in events) and open_return_points(events):
        return "Review points are still open. Clear them before filing."
    present = _latest(events, "present")
    if present is None:
        return "The return has not been presented to the client yet."
    if present.get("id") != event.get("presents"):
        return "That is not the version the client approved."
    if present.get("fingerprint") != fingerprint:
        return "The numbers have changed since the client approved them."
    signed = {e.get("signer") for e in events if e.get("type") == "approve" and e.get("presents") == present.get("id")}
    missing = [n for n in signers() if n not in signed]
    if missing:
        return f"Not everyone has signed yet: {', '.join(missing)}."
    snapshot = event.get("snapshot")
    if not isinstance(snapshot, dict) or not snapshot or len(snapshot) > MAX_SNAPSHOT:
        return "Filing must keep a snapshot of the numbers."
    return None


def open_return_points(events):
    cleared = {e.get("clears") for e in events if e.get("type") == "clear"}
    return [e for e in events if e.get("type") == "block" and e.get("id") not in cleared]


def current_value(filed, events, claim):
    """What a line stands at after filing: the last amendment, otherwise the filed number."""
    amends = [e for e in events if e.get("type") == "amend" and e.get("claim") == claim]
    return amends[-1].get("to") if amends else filed.get("snapshot", {}).get(claim)


def _check_amend(event, events):
    filed = filed_event(events)
    if filed is None:
        return "Nothing to amend: the return has not been filed. Adjust the number instead."
    claim = event.get("claim")
    if claim not in filed.get("snapshot", {}):
        return "That line is not on the filed return."
    if not (_is_number(event.get("from")) and _is_number(event.get("to"))):
        return "An amendment needs the old and the new number."
    if event.get("from") != current_value(filed, events, claim):
        return "The number has changed since you opened it. Reload and try again."
    if event.get("to") == event.get("from"):
        return "The amended number is the same as the current one."
    if len(str(event.get("text", "")).strip()) < MIN_REASON:
        return f"An amendment needs a reason of at least {MIN_REASON} characters."
    return None


def _check_present(event, events):
    fingerprint = event.get("fingerprint")
    if not isinstance(fingerprint, str) or not fingerprint or len(fingerprint) > 64:
        return "Presenting the return needs its fingerprint."
    points = {e.get("id") for e in events if e.get("type") == "block"} - {e.get("clears") for e in events if e.get("type") == "clear"}
    if points:
        return f"{len(points)} review point(s) are still open. Clear them before presenting the return."
    last = _latest(events, "present")
    if last is not None and last.get("fingerprint") == fingerprint:
        return "The return was already presented at these numbers."
    return None


def _check_approve(event, events):
    present = _latest(events, "present")
    if present is None or present.get("id") != event.get("presents"):
        return "That is not the return currently presented for approval."
    if present.get("fingerprint") != event.get("fingerprint"):
        return "The numbers have changed since the return was presented."
    signer = event.get("signer")
    if signer not in signers():
        return "The signer must be the taxpayer or the spouse."
    if str(event.get("signature", "")).strip().lower() != str(signer).strip().lower():
        return "Type the signer's full name to sign."
    if any(e.get("type") == "approve" and e.get("presents") == present.get("id") and e.get("signer") == signer for e in events):
        return f"{signer} has already signed this version."
    return None


def _check_assign(event):
    """An assignment names a staff role and says what to do; the deadline is optional but must be a real date."""
    if event.get("to") not in STAFF_ROLES:
        return "An assignment must say which member of staff it is for."
    if not str(event.get("text", "")).strip():
        return "An assignment must say what needs doing."
    due = event.get("due")
    if due:
        try:
            datetime.strptime(str(due), "%Y-%m-%d")
        except ValueError:
            return "A deadline must be a date like 2026-10-31."
    return None


def _check_done(event, events, role):
    """Only the person an assignment is for can mark it done, and only once."""
    task = next((e for e in events if e.get("id") == event.get("closes") and e.get("type") == "assign"), None)
    if task is None:
        return "That does not match any assignment."
    if task.get("to") != role:
        return f"That assignment is for the {task.get('to')}, not the {role}."
    if any(e.get("type") == "done" and e.get("closes") == task.get("id") for e in events):
        return "That assignment is already done."
    return None


def _check_clear(event, events):
    """A clear must close a real review point on the same line that is still open."""
    target = next((e for e in events if e.get("id") == event.get("clears") and e.get("type") == "block"), None)
    if target is None:
        return "That does not match any review point."
    if target.get("claim") != event.get("claim"):
        return "That review point belongs to a different line."
    if any(e.get("type") == "clear" and e.get("clears") == target.get("id") for e in events):
        return "That review point is already cleared."
    return None


def _check_answer(event, events, role):
    """An answer must reply to a real, unanswered question that was put to this role."""
    question = next((e for e in events if e.get("id") == event.get("answers") and e.get("type") == "question"), None)
    if question is None:
        return "That answer does not match any question."
    if question.get("to") != role:
        return f"That question is for the {question.get('to')}, not the {role}."
    if any(e.get("type") == "answer" and e.get("answers") == question.get("id") for e in events):
        return "That question is already answered."
    return None


def _already_signed(event, events):
    """True if the line's latest sign-off covers the same value and nothing changed the number since."""
    mine = [e for e in events if e.get("claim") == event.get("claim")]
    last = None
    for i, e in enumerate(mine):
        if e.get("type") == "signoff":
            last = i
    if last is None:
        return False
    changed_since = any(e.get("type") in ("adjust", "revert", "amend") for e in mine[last + 1:])
    return not changed_since and mine[last].get("valueAtSignoff") == event.get("valueAtSignoff")


# who may read the view log (the record of who opened which line or document)
VIEW_LOG_READERS = {"Reviewer", "Partner", "Administrator", "Quality reviewer"}
VIEW_KINDS = {"line", "source"}


def can_replace_events(role):
    """Replacing the whole saved list (PUT /api/events) is the Administrator's reset, nobody else's."""
    return role == "Administrator"


def can_read_views(role):
    return role in VIEW_LOG_READERS


def check_view(view):
    """Return None if a view record is acceptable, otherwise a plain sentence saying why not."""
    by = view.get("by")
    role = by.get("role") if isinstance(by, dict) else None
    target = view.get("target")
    if role not in ALLOWED:
        return f"Unknown role: {role!r}."
    if view.get("kind") not in VIEW_KINDS:
        return f"Unknown view kind: {view.get('kind')!r}."
    if not isinstance(target, str) or not target or len(target) > 200:
        return "A view needs a target (a line key or an evidence id)."
    return None


# ---- who may read a question and its answer -------------------------------------------------
# A question is private to the person who asked it, the person it is for, and the Partner
# (who signs off the whole file). Everyone else only learns that a question exists.

STAFF_ONLY_KINDS = ("block", "clear", "assign", "done", "time", "decision", "undo")  # the firm's internal working notes
STAFF_READERS = set(STAFF_ROLES) | {"Quality reviewer"}


def _may_read_question(question, role):
    by = question.get("by") or {}
    return role in (by.get("role"), question.get("to"), "Partner")


def visible_events(events, role):
    """The events this role is allowed to receive. Hidden questions become a bare stub; their answers are dropped."""
    questions = {e.get("id"): e for e in events if e.get("type") == "question"}
    out = []
    undone = undone_batches(events)
    for e in events:
        kind = e.get("type")
        if e.get("batch") in undone and kind != "undo":
            continue  # taken back by "undo last batch": the file keeps it, nobody is shown it
        if kind in STAFF_ONLY_KINDS and role not in STAFF_READERS:
            continue  # review points and assignments are not for the client or the administrator
        if kind == "question" and not _may_read_question(e, role):
            out.append({"id": e.get("id"), "claim": e.get("claim"), "type": "question", "private": True, "at": e.get("at")})
        elif kind == "answer" and not (questions.get(e.get("answers")) and _may_read_question(questions[e["answers"]], role)):
            continue
        else:
            out.append(e)
    return out
