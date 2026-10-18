"""rules.py - the server's own copy of "who may do what".

The browser already greys out buttons (frontend/src/roles.js). That only protects people who
use the buttons. The server runs these same rules on every event it is sent, so a request
that skips the page is refused too.

Keep this list in step with ROLES in frontend/src/roles.js.

Honest limit: the demo has no login. The server believes the role written in the event
("by.role"). It stops a role from doing what it is not allowed to, but it cannot prove
who is really sending. A real version would check a signed-in user instead.
"""

# role label (as written in event["by"]["role"]) -> event types that role may add
ALLOWED = {
    "Preparer": {"note", "adjust", "revert", "evidence", "question", "answer"},
    "Reviewer": {"note", "evidence", "verify", "signoff", "question", "answer"},
    "Partner": {"note", "evidence", "verify", "signoff", "question", "answer"},
    "Client": {"answer"},  # the client answers questions put to them and does nothing else
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
    if kind == "question" and event.get("to") not in ("Client", "Preparer", "Reviewer", "Partner"):
        return "A question must say who it is for."
    if kind == "answer":
        return _check_answer(event, events, role)
    if kind == "signoff" and _already_signed(event, events):
        return "This line is already signed off at this value. It can be signed again only after the value changes."
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
    changed_since = any(e.get("type") in ("adjust", "revert") for e in mine[last + 1:])
    return not changed_since and mine[last].get("valueAtSignoff") == event.get("valueAtSignoff")


# who may read the view log (the record of who opened which line or document)
VIEW_LOG_READERS = {"Reviewer", "Partner", "Administrator"}
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

def _may_read_question(question, role):
    by = question.get("by") or {}
    return role in (by.get("role"), question.get("to"), "Partner")


def visible_events(events, role):
    """The events this role is allowed to receive. Hidden questions become a bare stub; their answers are dropped."""
    questions = {e.get("id"): e for e in events if e.get("type") == "question"}
    out = []
    for e in events:
        kind = e.get("type")
        if kind == "question" and not _may_read_question(e, role):
            out.append({"id": e.get("id"), "claim": e.get("claim"), "type": "question", "private": True, "at": e.get("at")})
        elif kind == "answer" and not (questions.get(e.get("answers")) and _may_read_question(questions[e["answers"]], role)):
            continue
        else:
            out.append(e)
    return out
