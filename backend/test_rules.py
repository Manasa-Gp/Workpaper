"""Run:  python3 backend/test_rules.py"""
from rules import signers, open_blocks, visible_events, can_read_views, can_replace_events, check_event, check_view


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
# review points (blocking notes): Reviewer/Partner raise and clear; open ones block sign-off
def blk(id_="b1", claim="L"): return {**ev("Reviewer", "block"), "id": id_, "claim": claim, "text": "Source missing"}
def clr(role="Reviewer", to="b1", claim="L"): return {**ev(role, "clear"), "clears": to, "claim": claim}
def so(claim="L"): return {**ev("Reviewer", "signoff"), "claim": claim, "valueAtSignoff": 1}
assert check_event(blk()) is None
assert "may not" in check_event({**ev("Preparer", "block"), "text": "x"})        # the preparer cannot raise one
assert "may not" in check_event(clr("Preparer"), [blk()])                          # ...or clear one
assert "must say" in check_event({**ev("Reviewer", "block"), "text": "  "})
assert "open review points" in check_event(so(), [blk()])                          # open point blocks sign-off
assert check_event(so(), [blk(), clr()]) is None                                   # cleared: sign-off allowed
assert "does not match" in check_event(clr(to="zz"), [blk()])
assert "different line" in check_event(clr(claim="M"), [blk()])
assert "already cleared" in check_event(clr(), [blk(), clr()])
assert check_event(so("M"), [blk()]) is None                                       # another line is unaffected
assert len(open_blocks([blk(), blk("b2")], "L")) == 2
internal = [blk(), clr()]
for role in ("Preparer", "Reviewer", "Partner"):
    assert visible_events(internal, role) == internal
for role in ("Client", "Administrator", ""):
    assert visible_events(internal, role) == []                                    # not for the client
# assignments and deadlines
def asg(to="Preparer", due="2026-10-31", id_="t1", text="Find the 1099", role="Reviewer"): return {**ev(role, "assign"), "id": id_, "claim": "L", "to": to, "due": due, "text": text}
def dn(role="Preparer", to_id="t1"): return {**ev(role, "done"), "closes": to_id, "claim": "L"}
assert check_event(asg()) is None
assert check_event(asg(due="")) is None                                            # a deadline is optional
assert "may not" in check_event(asg(role="Preparer"))                              # the preparer cannot assign work
assert "may not" in check_event(asg(role="Client"))
assert "which member of staff" in check_event(asg(to="Client"))                    # tasks are for staff, not the client
assert "what needs doing" in check_event(asg(text=" "))
assert "real" not in check_event(asg(due="31/10/2026")) and "date like" in check_event(asg(due="31/10/2026"))
assert "date like" in check_event(asg(due="2026-13-45"))
assert check_event(dn(), [asg()]) is None                                          # the assignee closes it
assert "is for the Preparer" in check_event(dn("Reviewer"), [asg()])               # nobody else can
assert "already done" in check_event(dn(), [asg(), dn()])
assert "does not match" in check_event(dn(to_id="zz"), [asg()])
assert "may not" in check_event(dn("Client"), [asg()])
work = [asg(), dn()]
for role in ("Preparer", "Reviewer", "Partner"):
    assert visible_events(work, role) == work
for role in ("Client", "Administrator"):
    assert visible_events(work, role) == []                                        # internal to the firm
# presenting the return and the client's approval (Form 8879)
def pre(fp="F1", id_="p1", role="Reviewer"): return {**ev(role, "present"), "id": id_, "claim": "RETURN", "fingerprint": fp}
def apr(signer="Ngozi Okafor", fp="F1", pid="p1", sig=None, role="Client"):
    return {**ev(role, "approve"), "claim": "RETURN", "presents": pid, "fingerprint": fp, "signer": signer, "signature": sig or signer}
assert signers() == ("Ngozi Okafor", "Erik Lindqvist")                             # read from the packet: taxpayer and spouse, not the dependent
assert check_event(pre()) is None
assert "may not" in check_event(pre(role="Preparer"))                              # preparer cannot present
assert "may not" in check_event(pre(role="Client"))
assert "fingerprint" in check_event({**pre(), "fingerprint": ""})
assert "review point" in check_event(pre(), [blk()])                               # open review point anywhere stops it
assert check_event(pre(), [blk(), clr()]) is None
assert "already presented" in check_event(pre("F1", "p2"), [pre()])                # same numbers twice
assert check_event(pre("F2", "p2"), [pre()]) is None                               # changed numbers: present again
assert check_event(apr(), [pre()]) is None
assert "may not" in check_event(apr(role="Reviewer"), [pre()])                     # only the client approves
assert "not the return currently presented" in check_event(apr(), [])
assert "not the return currently presented" in check_event(apr(pid="p1"), [pre(), pre("F2", "p2")])   # an older version
assert "numbers have changed" in check_event(apr(fp="F0"), [pre()])
assert "taxpayer or the spouse" in check_event(apr("Ada Lindqvist-Okafor"), [pre()])  # the dependent cannot sign
assert "full name" in check_event(apr(sig="Nobody"), [pre()])
assert check_event(apr(sig="  ngozi okafor "), [pre()]) is None                    # case and spaces do not matter
assert "already signed" in check_event(apr(), [pre(), apr()])
assert check_event(apr("Erik Lindqvist"), [pre(), apr()]) is None                  # the spouse can still sign
for role in ("Preparer", "Reviewer", "Partner", "Client", "Administrator"):
    assert visible_events([pre(), apr()], role) == [pre(), apr()]                  # everyone sees the return's status
print("rules ok")
