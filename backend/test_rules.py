"""Run:  python3 backend/test_rules.py"""
from rules import can_read_views, check_event, check_view


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
print("rules ok")
