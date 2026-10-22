"""test_checks.py - what each check finds in the real packet. Run: python3 backend/test_checks.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from checks import (all_checks, books_bridge, claim_checks, cross_checks, duplicate_doc, duplicate_page, income_by_category,
                    load_index, parse_dated, printed_match, trace_claim, worst)

index = load_index()
assert index, "put packet.json in backend/data/"
passed = 0


def test(name):
    def wrap(fn):
        global passed
        fn()
        passed += 1
        print("ok  ", name)
    return wrap


def checks_of(key, value=None):
    return claim_checks(index, trace_claim(index, key), value)


def cross(cid):
    return next(c for c in cross_checks(index) if c["id"] == cid)


@test("the Halvorsen W-2 is flagged as a probable duplicate (D09 vs D10)")
def _():
    assert duplicate_doc(index, "D09")["status"] == "warn"
    assert duplicate_doc(index, "D10")["status"] == "warn"


@test("the corrected Meridian 1099 supersedes the original (D30 vs D31)")
def _():
    c = duplicate_doc(index, "D31")
    assert c["status"] == "pass" and "superseded" in c["detail"]


@test("mileage log page 3 is a second scan of page 2")
def _():
    assert duplicate_page(index, "D23", 3)["status"] == "warn"
    assert duplicate_page(index, "D23", 1)["status"] == "pass"


@test("SchC.44a shows the duplicate-page warning once, naming both pages and both sources")
def _():
    rows = [c for c in checks_of("SchC.44a") if c["id"] == "duppage" and c["status"] == "warn"]
    assert len(rows) == 1
    assert "Pages 2 and 3 of D23" in rows[0]["detail"]
    assert rows[0]["refs"] == ["ev-0315", "ev-0404"]


@test("the childcare provider ID misread is caught (ev-1045)")
def _():
    assert printed_match(index, index.values["ev-1045"])["status"] == "fail"


@test("a blank RSU basis recorded as 0 is flagged (ev-0498)")
def _():
    assert printed_match(index, index.values["ev-0498"])["status"] == "warn"


@test("the W-2 box 1 reads match the printed text")
def _():
    assert printed_match(index, index.values["ev-0016"])["status"] == "pass"


@test("F1040.1a: the two W-2 box 1 values add up; the D09/D10 copy passes but asks a person to verify")
def _():
    for key in ("F1040.1a", "F1040.25a"):
        checks = checks_of(key)
        note = next(c for c in checks if c.get("verify"))
        assert note["status"] == "pass" and note["verifyKey"] == "dupdoc:D09:D10"
        assert "D10 looks like a copy of D09" in note["detail"] and "D10 is not used" in note["detail"]
        assert not any(c["id"] == "dupdoc" and c["status"] == "warn" for c in checks)
    assert next(c for c in checks_of("F1040.1a") if c["id"] == "tie")["status"] == "pass"


@test("an adjusted value that no longer matches its sources gets its own warning, and the original row stays")
def _():
    assert not any(c["id"] == "tieAdjusted" for c in checks_of("F1040.1a", 212400))
    adjusted = checks_of("F1040.1a", 200000)
    assert next(c for c in adjusted if c["id"] == "tie")["status"] == "pass"
    row = next(c for c in adjusted if c["id"] == "tieAdjusted")
    assert row["status"] == "warn" and "no longer matches its sources" in row["detail"]


@test("estimated payments: 13,000 claimed against 12,000 at the IRS (the 2026-01 payment is 4,000 vs 3,000)")
def _():
    c = cross("pay-fed")
    assert c["status"] == "fail" and c["said"] == "13,000" and c["other"] == "12,000"
    assert "2026-01-14: 4,000 claimed, 3,000 at the IRS on 2026-01-15" in c["detail"]
    assert worst(checks_of("F1040.26")) == "fail"


@test("adjusting the payment line to the IRS figure makes its check pass; the original check is unchanged")
def _():
    trace = trace_claim(index, "F1040.26")
    after = next(c for c in claim_checks(index, trace, 12000) if c["id"] == "pay-fed")
    assert after["status"] == "pass" and "12,000" in after["detail"] and "adjusted" in after["detail"]
    still = next(c for c in claim_checks(index, trace, 12500) if c["id"] == "pay-fed")
    assert still["status"] == "fail" and "500" in still["detail"]
    assert cross("pay-fed")["status"] == "fail"


@test("California estimated payments: 14,000 claimed, 10,500 at the FTB; the 2025-09-15 payment was held for 2024")
def _():
    c = cross("pay-ca")
    assert c["status"] == "fail" and c["other"] == "10,500"
    assert "2025-09-15: 3,500 claimed, but the Franchise Tax Board holds it as" in c["detail"]


@test("the Subaru gift: 6,000 deducted, 2,900 sale price on Form 1098-C")
def _():
    c = cross("vehicle-F8283.A1.vehicle")
    assert c["status"] == "fail" and c["said"] == "6,000" and c["other"] == "2,900" and c["refs"] == ["ev-1054"]
    assert any(x["status"] == "fail" for x in checks_of("F8283.A1.vehicle"))


@test("Theo's Social Security number: the card (D71) ends 3390, the household record 3309; only last four digits are shown")
def _():
    c = cross("ssn-theo")
    assert c["status"] == "fail" and c["said"] == "ends 3309" and c["other"] == "ends 3390"
    assert "swapped" in c["detail"] and "666-74" not in c["detail"]
    assert "F8812.4" in c["lines"]


@test("California wages: 218,400 on the line, but the move (2025-07-15) and the paystub support 129,569")
def _():
    c = cross("ca-wages")
    assert c["status"] == "fail" and c["said"] == "218,400" and c["other"] == "129,569"
    assert "Corvane Systems, Inc.: 107,100 in full (the job ended 2025-05-16" in c["detail"]
    assert "Halvorsen Data LLC: 22,469 from the paystub (D73)" in c["detail"]
    assert worst(checks_of("SchCA540NR.1.E")) == "fail"


@test("SE health insurance: 14,400 deducted, but qa-25 and the W-2 dates show 12 of 12 months of employer coverage")
def _():
    c = cross("se-health")
    assert c["status"] == "fail" and c["said"] == "14,400" and c["other"] == "0"
    assert "Corvane Systems, Inc. (Jan–May), Halvorsen Data LLC (Jun–Dec)" in c["detail"] and "12 of 12 months" in c["detail"]
    assert c["refs"] == ["ev-0484"]


@test("dated payment lists are read correctly")
def _():
    assert parse_dated("2025-04-15 3,000.00; 2025-06-16 3,000.00") == [
        {"date": "2025-04-15", "amount": 3000}, {"date": "2025-06-16", "amount": 3000}]


@test("Cal1: the four pairs agree, and each Form 8949 box adds up")
def _():
    for cid in ("rec-capgain", "rec-interest", "rec-dividends", "rec-adjust", "rec-8949"):
        assert cross(cid)["status"] == "pass", cid
    assert cross("rec-capgain")["detail"] == "SchD.16 (185,027) and F1040.7 (185,027) agree."


@test("Cal4: income categories add up to the federal, California-law and California totals")
def _():
    assert len(income_by_category(index)) == 7
    for cid in ("rec-state-fed", "rec-state-law", "rec-state-ca"):
        assert cross(cid)["status"] == "pass", cid
    assert "324,260" in cross("rec-state-ca")["detail"]


@test("Cal3: the books bridge goes from 89,834 to 81,854 on Schedule C and on to taxable income 346,913")
def _():
    b = books_bridge(index)
    assert b["books_net"] == 89834 and b["unexplained"] == 0 and b["unknown"] == []
    steps = {r["label"].split(":")[0]: r["amount"] for r in b["rows"] if r["amount"] is not None}
    assert steps["Income reported that is not in the books"] == 12400
    assert steps["Car and truck - fuel"] == -5160 and steps["Depreciation"] == -30400
    assert steps["Insurance - health (Erik)"] == 14400 and steps["Meals"] == 1980
    assert [r["running"] for r in b["rows"] if r["label"] == "Net profit on Schedule C"] == [81854]
    assert b["rows"][-1]["running"] == 346913
    assert cross("rec-books")["status"] == "pass" and cross("rec-taxable")["status"] == "pass"


@test("the document-panel lists only hold problems")
def _():
    d = all_checks([])
    assert d["printed"]["ev-1045"]["status"] == "fail" and "ev-0016" not in d["printed"]
    assert "D09" in d["docs"] and "D23:3" in d["pages"] and "D23:1" not in d["pages"]


print(f"\n{passed} tests passed.")
