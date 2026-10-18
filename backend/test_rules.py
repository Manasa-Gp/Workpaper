"""Run:  python3 backend/test_rules.py"""
from rules import visible_events, can_read_views, can_replace_events, check_event, check_view


def ev(role, kind):
    return {"claim": "F1040.1a", "type": kind, "by": {"name": "x", "role": role}}


assert check_event(ev("Preparer", "adjust")) is None
assert check_event(ev("Preparer", "revert")) is None
assert check_event(ev("Reviewer", "signoff")) is None
assert check_event(ev("Partner", "verify")) is None
assert "may not" in check_event(ev("Preparer", "signoff"))      # a preparer cannot sign off
assert "may not" in check_event(ev("Reviewer", "adjust"))       # a reviewer cannot change a number
assert "may not" in check_event(ev("Client", "note"))           # the client adds nothing
assert "Unknown role" in check_event(ev("Intern", "note"))
assert "Unknown event type" in check_event(ev("Preparer", "delete"))
assert "Unknown role" in check_event({"claim": "a", "type": "note"})  # no "by" at all

# signing the same line twice
def so(value): return {**ev("Reviewer", "signoff"), "valueAtSignoff": value}
def adj(): return {**ev("Preparer", "adjust"), "from": 100, "to": 120}
assert check_event(so(100), []) is None                                    # first sign-off is fine
assert "already signed" in check_event(so(100), [so(100)])                # same value again: refused
assert check_event(so(120), [so(100)]) is None                            # a different value: allowed
assert check_event(so(120), [so(100), adj()]) is None                     # number changed since: allowed
assert check_event({**so(100), "claim": "F1040.2b"}, [so(100)]) is None   # a different line: allowed

# the view log
assert can_read_views("Reviewer") and can_read_views("Partner") and can_read_views("Administrator")
assert not can_read_views("Preparer") and not can_read_views("Client") and not can_read_views("")
good = {"target": "F1040.1a", "kind": "line", "by": {"name": "x", "role": "Reviewer"}}
assert check_view(good) is None
assert check_view({**good, "kind": "page"})
assert check_view({**good, "target": ""})
assert check_view({**good, "by": {"role": "Intern"}})
assert can_replace_events("Administrator")
assert not any(can_replace_events(r) for r in ("Preparer", "Reviewer", "Partner", "Client", ""))

# questions and answers
def q(to, id_="q1"): return {**ev("Reviewer", "question"), "id": id_, "to": to}
def ans(role, to_id="q1"): return {**ev(role, "answer"), "answers": to_id}
assert check_event(q("Client")) is None
assert "who it is for" in check_event({**ev("Reviewer", "question"), "to": "Nobody"})
assert check_event(ans("Client"), [q("Client")]) is None                  # the client answers a client question
assert "is for the Client" in check_event(ans("Preparer"), [q("Client")])   # the wrong person cannot answer
assert "already answered" in check_event(ans("Client"), [q("Client"), ans("Client")])
assert "does not match" in check_event(ans("Client", "nope"), [q("Client")])
assert "may not" in check_event(ev("Client", "question"))                  # the client cannot ask

# privacy of questions: asker, addressee and Partner read it; others get a stub, and never the answer
asked = {**ev("Preparer", "question"), "id": "q9", "to": "Client", "text": "secret", "at": "t"}
reply = {**ev("Client", "answer"), "id": "a9", "answers": "q9", "text": "private reply"}
allv = [asked, reply]
for role in ("Preparer", "Client", "Partner"):
    assert visible_events(allv, role) == allv                                      # the three who may read it
seen = visible_events(allv, "Reviewer")
assert len(seen) == 1 and seen[0]["private"] and "text" not in seen[0] and "by" not in seen[0]
assert visible_events(allv, "")[0]["private"]                                      # no role: nothing readable
assert visible_events([ev("Preparer", "note")], "Client")[0]["type"] == "note"     # other events are untouched
print("rules ok")
