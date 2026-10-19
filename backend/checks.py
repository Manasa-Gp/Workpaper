"""checks.py - the server's own copy of the data checks and the sign-off blocker.

The browser shows these checks (frontend/src/checks.js and crosschecks.js). They only protect people who
use the page, so the server runs the same rules before it accepts a 'signoff' event.

Keep this file in step with those two files. backend/test_parity.py runs both and compares every line,
so a change made in only one place shows up as a failing test.

Everything here reads the packet only. Nothing is saved.
"""

import json
import math
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

PACKET_PATH = Path(__file__).resolve().parent / "data" / "packet.json"
MIN_NOTE = 15  # same as MIN_NOTE in frontend/src/events.js


# ---------- small helpers that make the text match the browser's ----------

def fmt(n):
    """Like JavaScript's n.toLocaleString('en-US'): thousands separators, at most 3 decimals."""
    s = f"{round(float(n), 3):,.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def js_str(x):
    """Like JavaScript's String(x): 4000.0 prints as 4000."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, float) and x.is_integer() and abs(x) < 1e21:
        return str(int(x))
    return str(x)


def round2(n):
    return math.floor(n * 100 + 0.5) / 100  # JavaScript's Math.round(n * 100) / 100


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


NUMBER = re.compile(r"\d[\d,]*\.?\d*")


def numbers_in(text):
    found = set()
    for m in NUMBER.finditer(text):
        try:
            found.add(round2(float(m.group(0).replace(",", ""))))
        except ValueError:
            pass
    return found


def parse_money(text):
    cleaned = re.sub(r"[$,%\s]", "", str(text))
    cleaned = re.sub(r"^\((.*)\)$", r"-\1", cleaned)
    if cleaned == "":
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return None


def containment(a, b):
    if not a or not b:
        return 0
    return len(a & b) / min(len(a), len(b))


# ---------- the packet, indexed ----------

class Index:
    def __init__(self, packet):
        self.packet = packet
        self.documents = {d["id"]: d for d in packet["documents"]}
        self.values = {v["id"]: v for v in packet["extracted_values"]}
        self.values_by_doc = {}
        for v in packet["extracted_values"]:
            self.values_by_doc.setdefault(v["document_id"], []).append(v)
        self.versions = packet["return_versions"]
        self.current = self.versions[-1]
        self.by_key = {line["key"]: line for line in self.current["lines"]}
        self._page_numbers = {}
        self._doc_numbers = {}
        self._cross = None

    def page_numbers(self, doc, page):
        key = (doc["id"], page["page"])
        if key not in self._page_numbers:
            self._page_numbers[key] = numbers_in(page["printed_content"])
        return self._page_numbers[key]

    def doc_numbers(self, doc):
        if doc["id"] not in self._doc_numbers:
            allnums = set()
            for page in doc["pages"]:
                allnums |= numbers_in(page["printed_content"])
            self._doc_numbers[doc["id"]] = allnums
        return self._doc_numbers[doc["id"]]


@lru_cache(maxsize=1)
def load_index():
    try:
        with open(PACKET_PATH, encoding="utf-8") as f:
            return Index(json.load(f))
    except (OSError, ValueError, KeyError):
        return None


def resolve_source(index, ref):
    if ref.startswith("ev-"):
        value = index.values.get(ref)
        return {"ref": ref, "kind": "value", "value": value, "doc": index.documents.get(value["document_id"]) if value else None}
    if ref.startswith("doc:"):
        doc_id, _, page = ref[4:].partition("#page")
        try:
            page_no = int(page)
        except ValueError:
            page_no = None
        return {"ref": ref, "kind": "unread", "doc": index.documents.get(doc_id), "page": page_no}
    return {"ref": ref, "kind": "other"}


def trace_claim(index, key):
    line = index.by_key.get(key)
    if not line:
        return None
    return {"line": line, "sources": [resolve_source(index, r) for r in line.get("sources") or []]}


# ---------- checks on one extracted value ----------

def printed_match(index, value):
    label = "Matches the printed page"
    doc = index.documents.get(value["document_id"])
    page = next((p for p in doc["pages"] if p["page"] == value["page"]), None) if doc else None
    if not page:
        return {"id": "printed", "label": label, "status": "fail", "detail": f"Page {js_str(value['page'])} of {value['document_id']} is not in the packet."}
    printed = page["printed_content"]
    read = value.get("text_as_read")
    read = "" if read is None else read
    vtype = value.get("value_type")
    v = value.get("value")
    if v is None:
        return {"id": "printed", "label": label, "status": "warn", "detail": "The pipeline found no value for this field."}
    if read == "":
        return {"id": "printed", "label": label, "status": "warn", "detail": f"Nothing is printed in this field. The pipeline recorded {js_str(v)}."}
    if vtype in ("money", "integer", "quantity", "percent"):
        as_read = parse_money(read)
        if as_read is not None and abs(abs(as_read) - abs(v)) > 0.011 and vtype != "percent":
            return {"id": "printed", "label": label, "status": "fail", "detail": f'Text read as "{read}" but stored as {js_str(v)}.'}
        numbers = index.page_numbers(doc, page)
        target = round2(abs(v))
        hit = target in numbers or (vtype == "percent" and (target * 100 in numbers or target / 100 in numbers))
        if hit:
            return {"id": "printed", "label": label, "status": "pass", "detail": f"{read} appears on the printed page."}
        if target == 0:
            return {"id": "printed", "label": label, "status": "warn", "detail": "The page prints no such figure. A blank was recorded as 0."}
        return {"id": "printed", "label": label, "status": "fail", "detail": f"{read} does not appear on the printed page."}
    if vtype == "date":
        iso = js_str(v)
        m = re.match(r"^(\d{4})-(\d\d)-(\d\d)$", iso)
        us = f"{m.group(2)}/{m.group(3)}/{m.group(1)}" if m else None
        if iso in printed or (us and us in printed):
            return {"id": "printed", "label": label, "status": "pass", "detail": f"{read} appears on the printed page."}
        return {"id": "printed", "label": label, "status": "fail", "detail": f"{read} does not appear on the printed page."}
    if vtype == "boolean":
        return {"id": "printed", "label": label, "status": "na", "detail": "Checkbox. Not compared."}
    lower = printed.lower()
    if js_str(v).lower() in lower or read.lower() in lower:
        return {"id": "printed", "label": label, "status": "pass", "detail": f'"{read}" appears on the printed page.'}
    return {"id": "printed", "label": label, "status": "fail", "detail": f'"{read}" does not appear on the printed page.'}


def confidence(value):
    label = "Pipeline confidence"
    c = value.get("confidence")
    if not is_num(c):
        return {"id": "confidence", "label": label, "status": "na", "detail": "No score."}
    if c < 0.5:
        return {"id": "confidence", "label": label, "status": "fail", "detail": f"{c:.2f}. Too low to rely on."}
    if c < 0.8:
        return {"id": "confidence", "label": label, "status": "warn", "detail": f"{c:.2f}. Worth a second look."}
    return {"id": "confidence", "label": label, "status": "pass", "detail": f"{c:.2f}. A high score is not proof: the packet contains confident mistakes."}


# ---------- checks on documents and pages ----------

def duplicate_doc(index, doc_id):
    label = "Not a duplicate document"
    doc = index.documents.get(doc_id)
    if not doc:
        return {"id": "dupdoc", "label": label, "status": "na", "detail": ""}
    mine = index.doc_numbers(doc)
    for other in index.documents.values():
        if other["id"] == doc_id or other["issuer"] != doc["issuer"] or other["document_type"] != doc["document_type"]:
            continue
        theirs = index.doc_numbers(other)
        if len(mine) < 5 or len(theirs) < 5:
            continue
        if containment(mine, theirs) < 0.9:
            continue
        superseded = [d for v in index.versions for d in (v.get("documents_superseded") or [])]
        if other["id"] in superseded or doc_id in superseded:
            old = doc_id if doc_id in superseded else other["id"]
            replacement = other["id"] if old == doc_id else doc_id
            return {"id": "dupdoc", "label": label, "status": "pass", "detail": f"{old} was superseded by {replacement}. The engine uses {replacement}."}
        return {"id": "dupdoc", "label": label, "status": "warn", "doc": doc_id, "other": other["id"],
                "detail": f"Same issuer and the same figures as {other['id']}. Probably the same document uploaded twice."}
    return {"id": "dupdoc", "label": label, "status": "pass", "detail": "No other document from this issuer has the same figures."}


def duplicate_page(index, doc_id, page_no):
    label = "Not a duplicate page"
    doc = index.documents.get(doc_id)
    page = next((p for p in doc["pages"] if p["page"] == page_no), None) if doc else None
    if not page:
        return {"id": "duppage", "label": label, "status": "na", "detail": ""}
    mine = index.page_numbers(doc, page)
    if len(mine) < 8:
        return {"id": "duppage", "label": label, "status": "na", "detail": "Too little printed data to compare."}
    for other in doc["pages"]:
        if other["page"] == page_no:
            continue
        theirs = index.page_numbers(doc, other)
        if len(theirs) >= 8 and containment(mine, theirs) >= 0.9:
            return {"id": "duppage", "label": label, "status": "warn", "docId": doc_id, "pages": sorted([page_no, other["page"]]),
                    "detail": f"Page {page_no} has the same dates and figures as page {other['page']}. It may be a second scan of the same sheet, which would be counted twice."}
    return {"id": "duppage", "label": label, "status": "pass", "detail": "No other page in this document has the same figures."}


def source_checks(index, value):
    return [printed_match(index, value), confidence(value), duplicate_doc(index, value["document_id"]), duplicate_page(index, value["document_id"], value["page"])]


# ---------- checks on a claim ----------

def tie_out(line, sources):
    label = "Sources add up to the line"
    is_sum = bool(re.search(r"SUM|TOTALS", line.get("rule") or "")) and len(line.get("inputs") or []) == 0
    values = [s for s in sources if s["kind"] == "value" and s.get("value") and is_num(s["value"].get("value"))]
    if not is_sum or not values or len(values) != len(sources):
        return {"id": "tie", "label": label, "status": "na", "detail": "Not a plain sum of source values."}
    total = sum(s["value"]["value"] for s in values)
    diff = round2(total - line["value"])
    listed = " + ".join(fmt(s["value"]["value"]) for s in values)
    if abs(diff) < 0.5:
        return {"id": "tie", "label": label, "status": "pass", "detail": f"{listed} = {fmt(total)}.", "total": total}
    return {"id": "tie", "label": label, "status": "fail", "detail": f"Sources add to {fmt(total)}, the line says {fmt(line['value'])}.", "total": total}


def _adjusted_mismatch(line, tie, adjusted):
    if not is_num(adjusted) or adjusted == line["value"] or not is_num(tie.get("total")):
        return None
    if abs(tie["total"] - adjusted) < 0.5:
        return None
    return {"id": "tieAdjusted", "label": "Adjusted value matches its sources", "status": "warn",
            "detail": f"Adjusted value no longer matches its sources: they add to {fmt(tie['total'])}, the number now says {fmt(adjusted)}."}


def _resolve_duplicate(check, trace, tie):
    if check["id"] != "dupdoc" or check["status"] != "warn" or not check.get("other"):
        return check
    source_docs = []
    for s in trace["sources"]:
        d = (s.get("value") or {}).get("document_id") or (s.get("doc") or {}).get("id")
        if d and d not in source_docs:
            source_docs.append(d)
    if check["other"] in source_docs or tie["status"] != "pass":
        return check
    return {**check, "label": f"Possible copy of {check['other']}", "status": "pass", "verify": True,
            "verifyKey": f"dupdoc:{check['doc']}:{check['other']}",
            "detail": f"{check['doc']} looks like a copy of {check['other']}, but {check['other']} is not a source of this line (its sources are {' and '.join(source_docs)}), and the sources add up: {tie['detail']} Counted once."}


def claim_checks(index, trace, adjusted=None):
    checks = [tie_out(trace["line"], trace["sources"])]
    seen = set()
    for source in trace["sources"]:
        if source["kind"] == "unread":
            doc_id = (source.get("doc") or {}).get("id", "undefined")
            checks.append({"id": f"unread-{source['ref']}", "label": "Page was read", "status": "warn",
                           "detail": f"{doc_id} page {js_str(source['page'])} was never read by the pipeline.", "ref": source["ref"]})
        if source["kind"] != "value" or not source.get("value"):
            continue
        for check in source_checks(index, source["value"]):
            key = f"{check['id']}|{check['status']}|{check['detail']}|{source['value']['document_id']}"
            if check["id"] not in ("printed", "confidence") and key in seen:
                continue
            seen.add(key)
            pair = f"{check['docId']}:{'-'.join(str(p) for p in check['pages'])}" if check["id"] == "duppage" and check.get("pages") else None
            earlier = next((c for c in checks if pair and c.get("pair") == pair), None)
            if earlier:
                earlier["refs"].append(source["ref"])
                continue
            if pair:
                checks.append({**check, "pair": pair, "ref": source["ref"], "refs": [source["ref"]],
                               "detail": f"Pages {' and '.join(str(p) for p in check['pages'])} of {check['docId']} have the same dates and figures. It may be a second scan of the same sheet, which would be counted twice."})
            else:
                checks.append({**check, "ref": source["ref"]})
    adj = _adjusted_mismatch(trace["line"], checks[0], adjusted)
    if adj:
        checks.insert(1, adj)
    checks.extend(cross_checks_for(index, trace["line"]["key"]))
    return [_resolve_duplicate(c, trace, checks[0]) for c in checks]


# ---------- cross-checks (frontend/src/crosschecks.js) ----------

def _day_gap(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def parse_dated(note):
    return [{"date": m.group(1), "amount": float(m.group(2).replace(",", ""))}
            for m in re.finditer(r"(\d{4}-\d\d-\d\d)\s+([\d,]+(?:\.\d\d)?)", str(note or ""))]


def _payment_differences(claimed, agency, who, held):
    free = list(agency)
    out = []

    def take(c, near):
        for i, a in enumerate(free):
            if (_day_gap(a["date"], c["date"]) <= 3) if near else (a["date"] == c["date"]):
                return free.pop(i)
        return None

    unmatched = []
    for c in claimed:
        a = take(c, False)
        if not a:
            unmatched.append(c)
        elif a["amount"] != c["amount"]:
            out.append(f"{c['date']}: {fmt(c['amount'])} claimed, {fmt(a['amount'])} at {who}.")
    for c in unmatched:
        a = take(c, True)
        elsewhere = next((h for h in held if h["date"] == c["date"] and h["amount"] == c["amount"]), None)
        if a:
            out.append(f"{c['date']}: {fmt(c['amount'])} claimed, {fmt(a['amount'])} at {who} on {a['date']}.")
        elif elsewhere:
            note = elsewhere.get("note")
            what = (note[0].lower() + note[1:]) if note else "a payment for another year"
            out.append(f"{c['date']}: {fmt(c['amount'])} claimed, but {who} holds it as {what}.")
        else:
            out.append(f"{c['date']}: {fmt(c['amount'])} claimed, no such payment at {who}.")
    return out


def _payment_check(cid, label, line, agency, who, as_of, held=()):
    if not line or not is_num(line["value"]):
        return None
    total = sum(p["amount"] for p in agency)
    base = {"id": cid, "label": label, "lines": [line["key"]], "refs": []}
    if abs(line["value"] - total) < 0.5:
        return {**base, "status": "pass", "detail": f"The return claims {fmt(line['value'])} and {who} shows {fmt(total)} (as of {as_of}). They agree."}
    why = _payment_differences(parse_dated(line.get("note")), agency, who, list(held))
    sentence = who[0].upper() + who[1:]
    more_less = "less" if line["value"] > total else "more"
    tail = (" " + " ".join(why)) if why else ""
    return {**base, "status": "fail", "detail": f"The return claims {fmt(line['value'])}. {sentence} shows {fmt(total)} (as of {as_of}), {fmt(abs(line['value'] - total))} {more_less}.{tail}"}


def _payment_checks(index):
    records = index.packet.get("tax_agency_records") or {}
    out = []
    transcripts = records.get("irs_account_transcript_2025") or []
    if transcripts:
        irs = transcripts[-1]
        agency = [{"date": t["date"], "amount": t["amount"]} for t in irs["transactions"]
                  if t["code"] == "670" and is_num(t["amount"]) and re.search("estimated", t["description"], re.I)]
        out.append(_payment_check("pay-fed", "Estimated payments match the IRS record", index.by_key.get("F1040.26"), agency, "the IRS", irs["as_of"]))
    ftb = records.get("ftb_account")
    if ftb:
        agency = [{"date": p["date"], "amount": p["amount"]} for p in ftb["tax_year_2025_payments"]]
        out.append(_payment_check("pay-ca", "Estimated payments match the FTB record", index.by_key.get("F540NR.72"), agency,
                                  "the Franchise Tax Board", ftb["as_of"], ftb.get("tax_year_2024_payments_after_filing") or []))
    return [c for c in out if c]


def _vehicle_checks(index):
    out = []
    for line in index.current["lines"]:
        if not is_num(line["value"]):
            continue
        for ref in line.get("sources") or []:
            doc = (index.values.get(ref) or {}).get("document_id")
            proceeds = next((v for v in index.values_by_doc.get(doc, []) if v["field"] == "box4c" and is_num(v["value"])), None) if doc else None
            if not proceeds:
                continue
            base = {"id": f"vehicle-{line['key']}", "label": "Vehicle gift against the charity’s Form 1098-C", "lines": [line["key"]], "refs": [proceeds["id"]]}
            if line["value"] > proceeds["value"]:
                out.append({**base, "status": "fail", "detail": f"The return deducts {fmt(line['value'])}. {doc} (Form 1098-C) says the charity sold the vehicle for {fmt(proceeds['value'])} (box 4c). When the charity sells it without using it, the deduction is generally limited to the sale price."})
            else:
                out.append({**base, "status": "pass", "detail": f"The return deducts {fmt(line['value'])}, no more than the {fmt(proceeds['value'])} the charity got for the vehicle ({doc}, box 4c)."})
            break
    return out


def _digits(s):
    return re.sub(r"\D", "", str(s))


def _ssn_checks(index):
    out = []
    for person in index.packet["household"]["people"]:
        if not person.get("ssn"):
            continue
        card = next((v for v in index.values.values() if v.get("value_type") == "ssn"
                     and (index.documents.get(v["document_id"]) or {}).get("belongs_to") == f"dependent:{person['id']}"), None)
        if not card:
            continue
        first = person["name"].split(" ")[0]
        a, b = _digits(person["ssn"]), _digits(card["value"])
        lines = [l["key"] for l in index.current["lines"] if f"household:{person['id']}" in (l.get("sources") or [])]
        base = {"id": f"ssn-{person['id']}", "label": f"{first}’s Social Security number matches the card", "lines": lines, "refs": [card["id"]]}
        if a == b:
            out.append({**base, "status": "pass", "detail": f"{first}’s number in the household record and on the card ({card['document_id']}) agree (both end {a[-4:]})."})
        else:
            swap = len(a) == len(b) and a != b and sorted(a) == sorted(b)
            out.append({**base, "status": "fail", "detail": f"{first}’s number ends {a[-4:]} in the household record but {b[-4:]} on the card ({card['document_id']}).{' Two digits look swapped.' if swap else ''} The IRS matches names and numbers, so a wrong digit can reject the return."})
    return out


def _text_of(doc):
    return " ".join(p["printed_content"] for p in (doc or {}).get("pages", []))


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _us_date(m):
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}"


def _california_wages(index):
    line = index.by_key.get("SchCA540NR.1.E")
    move = next((r for r in index.packet["household"].get("residency") or [] if r["state"] != "CA"), None)
    if not line or not move or not is_num(line["value"]):
        return None
    w2s = [v for v in (index.values.get(r) for r in line.get("sources") or []) if v and v["field"] == "box16"]
    if not w2s:
        return None
    supported = 0
    unchecked = False
    parts, refs = [], []
    for w in w2s:
        doc = index.documents.get(w["document_id"])
        ended = re.search(r"Employment ended (\d\d)/(\d\d)/(\d{4})", _text_of(doc))
        pay = next((v for v in index.values.values() if v["field"] == "ytd_ca_wages" and (index.documents.get(v["document_id"]) or {}).get("issuer") == doc["issuer"]), None)
        refs.append(w["id"])
        if ended and _us_date(ended) < move["from"]:
            supported += w["value"]
            parts.append(f"{doc['issuer']}: {fmt(w['value'])} in full (the job ended {_us_date(ended)}, before the move).")
        elif pay:
            n = min(pay["value"], w["value"])
            supported += n
            refs.append(pay["id"])
            parts.append(f"{doc['issuer']}: {fmt(n)} from the paystub ({pay['document_id']}) up to the move, not the {fmt(w['value'])} on the W-2 ({doc['id']}).")
        else:
            supported += w["value"]
            unchecked = True
            parts.append(f"{doc['issuer']}: {fmt(w['value'])}, with no paystub to check the move against.")
    base = {"id": "ca-wages", "label": "California wages fit the move date and the paystub", "lines": [line["key"]], "refs": refs}
    joined = " ".join(parts)
    if abs(line["value"] - supported) < 0.5:
        return {**base, "status": "pass", "detail": f"California wages of {fmt(line['value'])} agree with the move date ({move['from']}) and the paystubs. {joined}"}
    more_less = "less" if line["value"] > supported else "more"
    return {**base, "status": "fail", "detail": f"The line takes {fmt(line['value'])} as California wages. The client moved to {move['state']} on {move['from']}, so only pay up to then is California's. {joined} That supports {fmt(supported)}, {fmt(abs(line['value'] - supported))} {more_less} than the line.{' One job could not be checked.' if unchecked else ''}"}


def _se_health(index):
    line = index.by_key.get("Sch1.17")
    qa = next((q for q in (index.packet.get("client") or {}).get("questionnaire") or [] if q["id"] == "qa-25"), None)
    if not line or not qa or not is_num(line["value"]) or not re.match(r"yes", qa["answer"], re.I):
        return None
    first_source = (line.get("sources") or [None])[0]
    doc = index.documents.get((index.values.get(first_source) or {}).get("document_id"))
    m = re.search(r"([\d,]+\.\d\d) per month", _text_of(doc))
    monthly = float(m.group(1).replace(",", "")) if m else None
    eligible, jobs = set(), []
    for ref in (index.by_key.get("F1040.1a") or {}).get("sources") or []:
        d = index.documents.get((index.values.get(ref) or {}).get("document_id"))
        if not d or any(j["id"] == d["id"] for j in jobs):
            continue
        t = _text_of(d)
        began = re.search(r"Employment began (\d\d)/(\d\d)/(\d{4})", t)
        ended = re.search(r"Employment ended (\d\d)/(\d\d)/(\d{4})", t)
        start = int(began.group(1)) if began else 1
        end = int(ended.group(1)) if ended else 12
        eligible.update(range(start, end + 1))
        jobs.append({"id": d["id"], "text": f"{d['issuer']} ({MONTHS[start - 1]}–{MONTHS[end - 1]})"})
    free = 12 - len(eligible)
    allowed = monthly * free if monthly is not None else None
    base = {"id": "se-health", "label": "Self-employed health insurance against the employer-coverage answer (qa-25)", "lines": [line["key"]], "refs": (line.get("sources") or [])[:1]}
    if allowed is None or line["value"] <= allowed + 0.5:
        return {**base, "status": "pass", "detail": f"The deduction of {fmt(line['value'])} is no more than the months without employer coverage allow."}
    return {**base, "status": "fail", "detail": f"The return deducts {fmt(line['value'])} ({fmt(monthly)} a month for 12 months). In qa-25 the client says Erik could have joined a family plan through Ngozi’s employers: {', '.join(j['text'] for j in jobs)}. That is {len(eligible)} of 12 months of eligibility, and the deduction is generally not allowed for those months, which leaves {fmt(allowed)}. Ask the client whether those plans were employer-subsidized."}


# Cal1 and Cal4 (frontend/src/crosschecks.js: PAIRS, form8949Check, incomeByCategory, stateChecks)

PAIRS = [
    ("rec-capgain", "Capital gain agrees between Schedule D and Form 1040", "SchD.16", "F1040.7"),
    ("rec-interest", "Taxable interest agrees between Schedule B and Form 1040", "SchB.4", "F1040.2b"),
    ("rec-dividends", "Ordinary dividends agree between Schedule B and Form 1040", "SchB.6", "F1040.3b"),
    ("rec-adjust", "Adjustments to income agree between Schedule 1 and Form 1040", "Sch1.26", "F1040.10"),
]


def _compare_two(cid, label, a, b):
    base = {"id": cid, "label": label, "lines": [a["key"], b["key"]], "refs": []}
    if abs(a["value"] - b["value"]) < 0.5:
        return {**base, "status": "pass", "detail": f"{a['key']} ({fmt(a['value'])}) and {b['key']} ({fmt(b['value'])}) agree."}
    return {**base, "status": "fail", "detail": f"{a['key']} says {fmt(a['value'])} but {b['key']} says {fmt(b['value'])}, a difference of {fmt(abs(a['value'] - b['value']))}."}


def _pair_checks(index):
    out = []
    for cid, label, ka, kb in PAIRS:
        a, b = index.by_key.get(ka), index.by_key.get(kb)
        if a and b and is_num(a["value"]) and is_num(b["value"]):
            out.append(_compare_two(cid, label, a, b))
    return out


def _form_8949_check(index):
    lines = index.current["lines"]
    boxes = [m.group(1) for m in (re.match(r"^F8949\.([A-Z])\.total$", l["key"]) for l in lines) if m]
    if not boxes:
        return None
    off, keys = [], []
    for box in boxes:
        total = index.by_key[f"F8949.{box}.total"]
        lots = [l for l in lines if l["key"].startswith(f"F8949.{box}.") and not l["key"].endswith(".total") and is_num(l["value"])]
        added = round2(sum(l["value"] for l in lots))
        keys.append(total["key"])
        if not is_num(total["value"]) or abs(added - total["value"]) >= 0.5:
            off.append(f"box {box}: {len(lots)} lots add to {fmt(added)}, the total line says {fmt(total['value']) if is_num(total['value']) else 'nothing'}")
    base = {"id": "rec-8949", "label": "Form 8949 lots add up to each box total", "lines": keys, "refs": []}
    if off:
        return {**base, "status": "fail", "detail": "; ".join(off) + "."}
    return {**base, "status": "pass", "detail": f"The lots in each of the {len(boxes)} boxes ({', '.join(boxes)}) add up to that box's total line."}


def income_by_category(index):
    rows = []
    for line in index.current["lines"]:
        m = re.match(r"^SchCA540NR\.(\d+)\.A$", line["key"])
        if not m:
            continue
        d, e = index.by_key.get(f"SchCA540NR.{m.group(1)}.D"), index.by_key.get(f"SchCA540NR.{m.group(1)}.E")
        if not d or not e:
            continue
        rows.append({"n": m.group(1), "label": re.sub(r" - federal$", "", line["label"]), "A": line["value"], "D": d["value"], "E": e["value"]})
    return rows


def _state_checks(index):
    rows = income_by_category(index)
    out = []
    for cid, label, col, total_key in (
        ("rec-state-fed", "Income by category adds up to total income on Form 1040", "A", "F1040.9"),
        ("rec-state-law", "Income by category adds up to total income using California law", "D", "SchCA540NR.22.D"),
        ("rec-state-ca", "California income by category adds up to total California income", "E", "SchCA540NR.22.E"),
    ):
        total = index.by_key.get(total_key)
        if not rows or not total or not is_num(total["value"]):
            continue
        added = round2(sum(r[col] for r in rows))
        base = {"id": cid, "label": label, "lines": [total_key], "refs": []}
        if abs(added - total["value"]) < 0.5:
            out.append({**base, "status": "pass", "detail": f"The {len(rows)} income categories add up to {fmt(added)}, the same as {total_key}."})
        else:
            out.append({**base, "status": "fail", "detail": f"The {len(rows)} income categories add up to {fmt(added)}, but {total_key} says {fmt(total['value'])}, a difference of {fmt(abs(added - total['value']))}."})
    return out


def cross_checks(index):
    if index._cross is None:
        index._cross = [c for c in [*_payment_checks(index), *_vehicle_checks(index), *_ssn_checks(index), _california_wages(index), _se_health(index), *_pair_checks(index), _form_8949_check(index), *_state_checks(index)] if c]
    return index._cross


def cross_checks_for(index, key):
    return [{"id": c["id"], "label": c["label"], "status": c["status"], "detail": c["detail"], "refs": c["refs"], "ref": c["refs"][0] if c["refs"] else None}
            for c in cross_checks(index) if key in c["lines"]]


# ---------- the sign-off blocker (frontend/src/events.js: signoffBlocker) ----------

def effective_value(line, events):
    changes = [e for e in events if e.get("claim") == line["key"] and e.get("type") in ("adjust", "revert", "amend")]
    return changes[-1].get("to") if changes else line["value"]


def signoff_check_problem(events, claim):
    """A sentence saying why the checks stop this sign-off, or None. `events` are the ones that still count (undone batches removed)."""
    index = load_index()
    if index is None:
        return None  # no packet on the server: nothing to check against
    trace = trace_claim(index, claim)
    if not trace:
        return None  # not a line of the return (for example the whole-return key)
    checks = claim_checks(index, trace, effective_value(trace["line"], events))
    verified = {e.get("check") for e in events if e.get("claim") == claim and e.get("type") == "verify"}
    if any(c.get("verify") and c.get("verifyKey") not in verified for c in checks):
        return "A flagged check is waiting for verification. Click Mark verified first."
    problem = next((c for c in checks if c["status"] in ("fail", "warn")), None)
    notes = [e for e in events if e.get("claim") == claim and e.get("type") == "note" and len(str(e.get("text") or "").strip()) >= MIN_NOTE]
    if problem and not notes:
        what = "A check failed" if problem["status"] == "fail" else "A check shows a warning"
        return f"{what}. Add a note explaining it (at least {MIN_NOTE} characters) before signing."
    return None


# ---------- everything at once, for GET /api/checks ----------

_ORDER = ["fail", "warn", "pass", "na"]


def worst(checks):
    """The most serious status in a list: fail, then warn, then pass, then na (same order as the screen)."""
    for status in _ORDER:
        if any(c["status"] == status for c in checks):
            return status
    return "na"


def all_checks(events):
    """Every claim's checks (using its current adjusted value) plus the cross-checks, ready to send as JSON.
    `events` are the ones that still count (undone batches already removed)."""
    index = load_index()
    if index is None:
        return None
    claims = {}
    for line in index.current["lines"]:
        trace = trace_claim(index, line["key"])
        checks = claim_checks(index, trace, effective_value(line, events))
        claims[line["key"]] = {"worst": worst(checks), "checks": checks}
    return {"claims": claims, "cross": cross_checks(index)}
