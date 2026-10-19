"""Run:  python3 backend/test_rules.py"""
from rules import signers, open_blocks, visible_events, can_read_views, can_replace_events, check_event, check_view, filed_event


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

# ---- freeze at filing, amend on top ----
def fil(fp="F1", pid="p1", role="Partner", snap=None):
    return {**ev(role, "file"), "id": "f1", "claim": "RETURN", "fingerprint": fp, "presents": pid, "snapshot": snap if snap is not None else {"F1040.1a": 100, "F1040.1z": 200}}
def amd(frm=100, to=150, text="Client sent a corrected W-2 on 3 Nov", claim="F1040.1a", role="Preparer"):
    return {**ev(role, "amend"), "claim": claim, "from": frm, "to": to, "text": text}
def sgn(value): return {**ev("Reviewer", "signoff"), "claim": "F1040.1a", "valueAtSignoff": value}
approved = [pre(), apr(), apr("Erik Lindqvist")]
assert filed_event(approved) is None
assert check_event(fil(), approved) is None                                         # approved by both: the Partner can file
assert "may not" in check_event(fil(role="Reviewer"), approved)                    # only the Partner files
assert "may not" in check_event(fil(role="Preparer"), approved)
assert "may not" in check_event(fil(role="Client"), approved)
assert "not been presented" in check_event(fil(), [])
assert "Not everyone has signed" in check_event(fil(), [pre(), apr()])             # the spouse has not signed
assert "numbers have changed" in check_event(fil("F2"), approved)                  # numbers moved after approval
assert "not the version" in check_event(fil(pid="zzz"), approved)
assert "Review points are still open" in check_event(fil(), approved + [blk()])
assert "snapshot" in check_event(fil(snap={}), approved)
assert "already filed" in check_event(fil(), approved + [fil()])
filed = approved + [fil()]
assert filed_event(filed)["fingerprint"] == "F1"
# after filing the numbers are frozen
assert "frozen" in check_event(adj(), filed)                                       # no adjusting
assert "frozen" in check_event(ev("Preparer", "revert"), filed)                    # no reverting
assert "frozen" in check_event(pre("F2", "p2"), filed)                             # no presenting again
assert "frozen" in check_event(apr("Erik Lindqvist"), filed)                       # no new signatures
assert "frozen" in check_event(sgn(100), filed)                                     # no sign-off on an unamended line
assert check_event({**ev("Preparer", "note"), "claim": "F1040.1a"}, filed) is None  # notes still work
assert check_event({**ev("Reviewer", "evidence"), "claim": "F1040.1a"}, filed) is None
# amendments
assert "not been filed" in check_event(amd(), approved)                            # nothing to amend before filing
assert check_event(amd(), filed) is None
assert "may not" in check_event(amd(role="Reviewer"), filed)
assert "not on the filed return" in check_event(amd(claim="Nope.1"), filed)
assert "changed since" in check_event(amd(frm=99), filed)                          # stale "from"
assert "same as" in check_event(amd(to=100), filed)
assert "reason" in check_event(amd(text="fix"), filed)
assert "old and the new" in check_event({**amd(), "to": "150"}, filed)
assert "old and the new" in check_event({**amd(), "to": True}, filed)
assert "changed since" in check_event(amd(frm=100, to=170), filed + [amd()])       # the line now stands at 150
assert check_event(amd(frm=150, to=170), filed + [amd()]) is None                  # a second amendment chains on the first
assert check_event(sgn(150), filed + [amd()]) is None                               # an amended line can be signed
assert "already signed" in check_event(sgn(150), filed + [amd(), sgn(150)])
assert check_event(sgn(170), filed + [amd(), sgn(150), amd(150, 170)]) is None       # and re-signed after another amendment
for role in ("Preparer", "Reviewer", "Partner", "Client", "Administrator"):
    assert [e for e in visible_events(filed + [amd()], role) if e["type"] in ("file", "amend")]   # everyone sees filed status
print("rules ok")


# Fm2: the Partner must sign off an adjustment with a tax effect over 1,000; the quality reviewer only reads
def adj_fx(fed, ca=0): return {**ev("Preparer", "adjust"), "from": 100, "to": 200, "taxEffect": {"federal": fed, "california": ca}}
assert "Partner" in check_event({**ev("Reviewer", "signoff"), "valueAtSignoff": 200}, [adj_fx(1500)])      # over 1,000: reviewer refused
assert check_event({**ev("Partner", "signoff"), "valueAtSignoff": 200}, [adj_fx(1500)]) is None             # the Partner may
assert check_event({**ev("Reviewer", "signoff"), "valueAtSignoff": 200}, [adj_fx(900)]) is None             # under 1,000: reviewer may
assert "Partner" in check_event({**ev("Reviewer", "signoff"), "valueAtSignoff": 200}, [adj_fx(10, -1200)])  # California counts too
assert check_event({**ev("Reviewer", "signoff"), "valueAtSignoff": 100}, [adj_fx(1500), ev("Preparer", "revert")]) is None  # reverted: no longer an adjustment
assert "may not" in check_event(ev("Quality reviewer", "note"))                                             # read-only
assert can_read_views("Quality reviewer")

# Fm3: time against budget
def tm(area, hours): return {**ev("Preparer", "time"), "area": area, "hours": hours}
assert check_event(tm("business", 1.5)) is None
assert "budget areas" in check_event(tm("lunch", 1))
assert "Hours" in check_event(tm("business", 0))
assert "Hours" in check_event(tm("business", 25))
assert "Hours" in check_event(tm("business", "3"))
assert "may not" in check_event({**tm("business", 1), "by": {"name": "x", "role": "Client"}})
assert not any(e.get("type") == "time" for e in visible_events([tm("business", 1)], "Client"))
assert any(e.get("type") == "time" for e in visible_events([tm("business", 1)], "Reviewer"))


# J1/J2: explaining a swing, and recording a judgment with its authority
def dec(**kw): return {**ev("Preparer", "decision"), "category": "election", "text": "Elected to expense the equipment", "authority": "IRC 179", **kw}
assert check_event(dec()) is None
assert "authority" in check_event(dec(authority=""))
assert "decided" in check_event(dec(text="short"))
assert "election" in check_event(dec(category="hunch"))
assert "may not" in check_event({**dec(), "by": {"name": "x", "role": "Client"}})
assert not any(e.get("type") == "decision" for e in visible_events([dec()], "Client"))
assert "15 characters" in check_event({**ev("Preparer", "note"), "swing": True, "text": "up"})
assert check_event({**ev("Preparer", "note"), "swing": True, "text": "Ngozi changed jobs in July, so wages rose."}) is None
print("judgment ok")


# Ch4: undo the latest batch
def bn(batch, claim="X"): return {**ev("Preparer", "note"), "claim": claim, "batch": batch, "text": "hi"}
def und(batch): return {**ev("Preparer", "undo"), "batch": batch}
assert check_event(und("b2"), [bn("b1"), bn("b2"), bn("b2", "Y")]) is None
assert "latest" in check_event(und("b1"), [bn("b1"), bn("b2")])
assert "no batch" in check_event(und("b1"), [bn("b1"), und("b1")])
assert check_event(und("b1"), [bn("b1"), bn("b2"), und("b2")]) is None        # after b2 is undone, b1 is the latest
assert "may not" in check_event({**und("b1"), "by": {"name": "x", "role": "Client"}}, [bn("b1")])
seen = visible_events([bn("b1"), und("b1")], "Reviewer")
assert [e["type"] for e in seen] == ["undo"]                                   # the batch note is gone, the undo shows
assert visible_events([bn("b1"), und("b1")], "Client") == []                    # the client sees neither
print("batch ok")
