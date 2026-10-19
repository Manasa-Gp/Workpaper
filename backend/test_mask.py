"""test_mask.py - the server hides sensitive numbers, and only reveals them to a cleared role. Run: python3 backend/test_mask.py"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from checks import ssn_mismatch, ssn_mismatches
from mask import cleared, find_record, mask_deep, mask_number, mask_text

packet = json.loads((Path(__file__).resolve().parent / "data" / "packet.json").read_text(encoding="utf-8"))
FULL_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
passed = 0


def test(name):
    def wrap(fn):
        global passed
        fn()
        passed += 1
        print("ok  ", name)
    return wrap


@test("SSNs, PINs and bank numbers are hidden in records, on a copy")
def _():
    theo = next(p for p in packet["household"]["people"] if p["id"] == "theo")
    before = json.dumps(theo)
    masked = mask_deep(theo)
    assert masked["ssn"] == "•••-••-3309" and masked["name"] == theo["name"]
    assert json.dumps(theo) == before, "the original is not changed"
    bank = mask_deep(packet["household"]["bank_account_for_refund_or_payment"])
    assert bank["account"].endswith("9276") and "4483" not in bank["account"]
    assert bank["routing"].endswith("0017") and "9900" not in bank["routing"]
    assert mask_deep(packet["household"]["people"][0])["ip_pin"] == "••••••"
    signed = next(e for e in packet["timeline"] if e["event"] == "client_approved_and_signed_8879")
    assert not re.search(r"41207|88310", mask_deep(signed)["detail"])
    assert mask_text("SSN 666-41-2287 PIN 123456") == "SSN •••-••-2287 PIN ••••••"
    assert mask_number("abc") == "•••"


@test("the whole packet that leaves the server has no full Social Security number")
def _():
    assert FULL_SSN.search(json.dumps(packet)), "the real packet does have some"
    assert not FULL_SSN.search(json.dumps(mask_deep(packet), ensure_ascii=False))


@test("only staff the packet marks as cleared may reveal")
def _():
    for role in ("preparer", "reviewer", "partner", "admin"):
        assert cleared(packet, role), role
    assert not cleared(packet, "preparer2"), "Marcus Bell is not cleared"
    assert not cleared(packet, "client") and not cleared(packet, "nobody")
    changed = json.loads(json.dumps(packet))
    next(s for s in changed["firm"]["staff"] if s["id"] == "st-01")["sensitive_data_clearance"] = False
    assert not cleared(changed, "preparer"), "the answer comes from the packet, not the role name"


@test("a reveal finds the real record behind a source reference")
def _():
    assert find_record(packet, "household:theo")["ssn"] == "666-74-3309"
    assert find_record(packet, "household:nobody") is None
    assert find_record(packet, "ev-0016") is None, "documents are not revealed this way"


@test("the rejection names Theo: the server compares the numbers and only sends them masked")
def _():
    found = ssn_mismatches(packet)
    assert len(found) == 1
    m = next(iter(found.values()))
    assert (m["person"], m["docId"], m["swapped"]) == ("Theo Lindqvist-Okafor", "D71", True)
    assert m["organizer"] == "•••-••-3309" and m["card"] == "•••-••-3390" and m["valueRef"] == "ev-1080"
    assert ssn_mismatch(packet, "nobody in the household is named here") is None


print(f"\n{passed} tests passed.")
