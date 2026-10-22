"""checks.py - ALL the data checks and the sign-off blocker. The server is the only place these rules live.

GET /api/checks (server.py) sends the results; the page only displays them. The same rules run again before
the server accepts a 'signoff' event, so they cannot be skipped by using another tool.
Tests: backend/test_checks.py (what each check finds in the real packet) and backend/test_rules.py.

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
    # check["doc"] is a source of this line; check["other"] is not. So the copy is the one that is not used.
    return {**check, "label": f"{check['other']} may be a copy of {check['doc']}", "status": "pass", "verify": True,
            "verifyKey": f"dupdoc:{check['doc']}:{check['other']}",
            "detail": f"{check['other']} looks like a copy of {check['doc']}, which is a source of this line. {check['other']} is not used (the sources are {' and '.join(source_docs)}), and the sources add up: {tie['detail']} Counted once."}


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
    checks.extend(cross_checks_for(index, trace["line"]["key"], adjusted))
    return [_resolve_duplicate(c, trace, checks[0]) for c in checks]


# ---------- cross-checks against agencies and documents ----------

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
    base = {"id": cid, "label": label, "lines": [line["key"]], "refs": [], "said": fmt(line["value"]), "other": fmt(total),
            "items": [{"date": p["date"], "amount": fmt(p["amount"])} for p in agency], "itemsTitle": f"Payments {who} shows", "recordId": "payments",
            "agencyTotal": total, "who": who, "asOf": as_of}
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
            base = {"id": f"vehicle-{line['key']}", "label": "Vehicle gift against the charity’s Form 1098-C", "lines": [line["key"]], "refs": [proceeds["id"]], "said": fmt(line["value"]), "other": fmt(proceeds["value"])}
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
        base = {"id": f"ssn-{person['id']}", "label": f"{first}’s Social Security number matches the card", "lines": lines, "refs": [card["id"]], "said": f"ends {a[-4:]}", "other": f"ends {b[-4:]}"}
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
    base = {"id": "ca-wages", "label": "California wages fit the move date and the paystub", "lines": [line["key"]], "refs": refs, "said": fmt(line["value"]), "other": fmt(supported)}
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
    base = {"id": "se-health", "label": "Self-employed health insurance against the employer-coverage answer (qa-25)", "lines": [line["key"]], "refs": (line.get("sources") or [])[:1], "said": fmt(line["value"]), "other": "unknown" if allowed is None else fmt(allowed)}
    if allowed is None or line["value"] <= allowed + 0.5:
        return {**base, "status": "pass", "detail": f"The deduction of {fmt(line['value'])} is no more than the months without employer coverage allow."}
    return {**base, "status": "fail", "detail": f"The return deducts {fmt(line['value'])} ({fmt(monthly)} a month for 12 months). In qa-25 the client says Erik could have joined a family plan through Ngozi’s employers: {', '.join(j['text'] for j in jobs)}. That is {len(eligible)} of 12 months of eligibility, and the deduction is generally not allowed for those months, which leaves {fmt(allowed)}. Ask the client whether those plans were employer-subsidized."}


# Cal1 (figures that should agree) and Cal4 (income split between states)

PAIRS = [
    ("rec-capgain", "Capital gain agrees between Schedule D and Form 1040", "SchD.16", "F1040.7"),
    ("rec-interest", "Taxable interest agrees between Schedule B and Form 1040", "SchB.4", "F1040.2b"),
    ("rec-dividends", "Ordinary dividends agree between Schedule B and Form 1040", "SchB.6", "F1040.3b"),
    ("rec-adjust", "Adjustments to income agree between Schedule 1 and Form 1040", "Sch1.26", "F1040.10"),
]


def _compare_two(cid, label, a, b):
    base = {"id": cid, "label": label, "group": "reconcile", "lines": [a["key"], b["key"]], "refs": [], "said": fmt(a["value"]), "other": fmt(b["value"])}
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
    base = {"id": "rec-8949", "label": "Form 8949 lots add up to each box total", "group": "reconcile", "lines": keys, "refs": [], "said": f"{len(boxes)} box totals", "other": f"{len(off)} differ" if off else "all agree"}
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
        n = m.group(1)
        rows.append({"n": n, "label": re.sub(r" - federal$", "", line["label"]),
                     "keys": {"A": line["key"], "D": d["key"], "E": e["key"]},
                     "A": line["value"], "D": d["value"], "E": e["value"], "outside": round2(d["value"] - e["value"])})
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
        base = {"id": cid, "label": label, "group": "state", "lines": [total_key], "refs": [], "said": fmt(added), "other": fmt(total["value"])}
        if abs(added - total["value"]) < 0.5:
            out.append({**base, "status": "pass", "detail": f"The {len(rows)} income categories add up to {fmt(added)}, the same as {total_key}."})
        else:
            out.append({**base, "status": "fail", "detail": f"The {len(rows)} income categories add up to {fmt(added)}, but {total_key} says {fmt(total['value'])}, a difference of {fmt(abs(added - total['value']))}."})
    return out


# Cal3: from the studio's books to taxable income

# (books lines, Schedule C line, why the two can differ). Empty line key = the books expense has no line on Schedule C.
BOOKS_MAP = [
    (["Advertising"], "SchC.8", ""),
    (["Car and truck - fuel"], "SchC.9", "The return uses the standard mileage rate instead of the fuel actually bought."),
    (["Contract labor"], "SchC.11", ""),
    (["Depreciation"], "SchC.13", "Tax depreciation (including section 179) is worked out separately from the books' straight-line figure."),
    (["Insurance - business liability"], "SchC.15", ""),
    (["Insurance - health (Erik)"], None, "Self-employed health insurance is not a Schedule C expense. It is deducted on Schedule 1 (line 17) instead."),
    (["Internet", "Telephone"], "SchC.25", ""),
    (["Legal and professional"], "SchC.17", ""),
    (["Meals"], "SchC.24b", "Only 50% of business meals is deductible."),
    (["Office expenses"], "SchC.18", ""),
    (["Software and subscriptions"], "SchC.27a.1", ""),
    (["Supplies"], "SchC.22", ""),
    (["Travel"], "SchC.24a", ""),
    (["Bank and merchant fees"], "SchC.27a.2", ""),
]


def _books(index):
    doc = next((d for d in index.packet["documents"] if d.get("document_type") == "books_profit_loss"), None)
    if not doc:
        return None
    vals = {v["field"]: v for v in index.values_by_doc.get(doc["id"], []) if is_num(v["value"])}
    return doc, vals


def books_bridge(index):
    """Rows from the books' net income to taxable income, and the checks that the steps add up.
    Each row: {label, amount, running, why, lines, refs}. `amount` is None for a starting figure."""
    found = _books(index)
    net_line, receipts = index.by_key.get("SchC.31"), index.by_key.get("SchC.1")
    if not found or not net_line or not receipts or "net_income" not in found[1]:
        return None
    doc, vals = found
    refs = lambda *ids: [i for i in ids if i]
    books_net = vals["net_income"]["value"]
    rows = [{"label": "Net income in the books", "amount": None, "running": books_net, "why": f"{doc['id']}, cash basis profit and loss.", "lines": [], "refs": refs(vals["net_income"]["id"])}]
    running = books_net
    unknown = []

    def step(label, amount, why, lines, rrefs):
        nonlocal running
        amount = round2(amount)
        if abs(amount) < 0.5:
            return
        running = round2(running + amount)
        rows.append({"label": label, "amount": amount, "running": running, "why": why, "lines": lines, "refs": rrefs})

    sales = [v for f, v in vals.items() if f.startswith("Sales")]
    books_income = vals["total_income"]["value"] if "total_income" in vals else sum(v["value"] for v in sales)
    step("Income reported that is not in the books", receipts["value"] - books_income,
         receipts.get("note") or "Gross receipts differ from the books' total income.", ["SchC.1"], refs(*[v["id"] for v in sales][:1]))
    used = {"net_income", "total_income", "total_expenses"} | {v["field"] for v in sales}
    for names, key, why in BOOKS_MAP:
        have = [vals[n] for n in names if n in vals]
        used.update(names)
        books_amt = sum(v["value"] for v in have)
        tax_line = index.by_key.get(key) if key else None
        tax_amt = tax_line["value"] if tax_line and is_num(tax_line["value"]) else 0
        step(f"{' and '.join(names)}: {fmt(books_amt)} in the books, {fmt(tax_amt)} on the return" if tax_line or have else "", books_amt - tax_amt,
             (tax_line or {}).get("note") or why or "Different from the books.", [key] if key else ["Sch1.17"] if "health" in names[0] else [], refs(*[v["id"] for v in have][:1]))
    home = index.by_key.get("SchC.30")
    if home and is_num(home["value"]):
        step(f"Home office deduction: {fmt(home['value'])}, not in the books", -home["value"], "The simplified home office method has no books entry.", ["SchC.30"], [])
    for field, v in vals.items():
        if field not in used:
            unknown.append(field)
    unexplained = round2(net_line["value"] - running)
    rows.append({"label": "Net profit on Schedule C", "amount": None, "running": net_line["value"], "why": "Schedule C line 31.", "lines": ["SchC.31"], "refs": []})
    chain = []
    total, adj, agi, ded, tax = (index.by_key.get(k) for k in ("F1040.9", "F1040.10", "F1040.11", "F1040.14", "F1040.15"))
    biz = index.by_key.get("Sch1.3")
    if all(x and is_num(x["value"]) for x in (total, adj, agi, ded, tax, biz)):
        rows.append({"label": "Business income carried to Schedule 1", "amount": None, "running": biz["value"], "why": "Schedule 1 line 3.", "lines": ["Sch1.3"], "refs": []})
        rows.append({"label": "All other income on the return", "amount": round2(total["value"] - biz["value"]), "running": total["value"], "why": "Wages, interest, dividends, sales, rentals and the rest, to total income.", "lines": ["F1040.9"], "refs": []})
        rows.append({"label": "Adjustments to income", "amount": -adj["value"], "running": agi["value"], "why": "Taken off to reach adjusted gross income.", "lines": ["F1040.10", "F1040.11"], "refs": []})
        rows.append({"label": "Deductions", "amount": -ded["value"], "running": tax["value"], "why": "Taken off to reach taxable income.", "lines": ["F1040.14", "F1040.15"], "refs": []})
        chain = [("Schedule 1 business income equals Schedule C net profit", abs(biz["value"] - net_line["value"]) < 0.5, f"Sch1.3 is {fmt(biz['value'])} and SchC.31 is {fmt(net_line['value'])}."),
                 ("Total income less adjustments is adjusted gross income", abs(total["value"] - adj["value"] - agi["value"]) < 0.5, f"{fmt(total['value'])} less {fmt(adj['value'])} is {fmt(total['value'] - adj['value'])}; the return says {fmt(agi['value'])}."),
                 ("Adjusted gross income less deductions is taxable income", abs(agi["value"] - ded["value"] - tax["value"]) < 0.5, f"{fmt(agi['value'])} less {fmt(ded['value'])} is {fmt(agi['value'] - ded['value'])}; the return says {fmt(tax['value'])}.")]
    return {"rows": rows, "unexplained": unexplained, "unknown": unknown, "chain": chain, "books_net": books_net, "net_line": net_line}


def _books_checks(index):
    b = books_bridge(index)
    if not b:
        return []
    net = b["net_line"]
    base = {"id": "rec-books", "label": "Books net income bridges to Schedule C net profit", "group": "reconcile", "lines": ["SchC.31"], "refs": [], "said": fmt(net["value"]), "other": fmt(net["value"] - b["unexplained"])}
    steps = len([r for r in b["rows"] if r["amount"] is not None and r["label"] != "All other income on the return"]) 
    extra = f" The books also list {', '.join(b['unknown'])}, which no step covers." if b["unknown"] else ""
    if abs(b["unexplained"]) < 0.5 and not b["unknown"]:
        out = [{**base, "status": "pass", "detail": f"From {fmt(b['books_net'])} in the books, the listed differences lead exactly to {fmt(net['value'])} on Schedule C line 31."}]
    else:
        out = [{**base, "status": "fail", "detail": f"From {fmt(b['books_net'])} in the books, the listed differences lead to {fmt(net['value'] - b['unexplained'])}, but Schedule C line 31 says {fmt(net['value'])}: {fmt(abs(b['unexplained']))} is unexplained.{extra}"}]
    bad = [f"{label}: {detail}" for label, ok, detail in b["chain"] if not ok]
    if b["chain"]:
        tb = {"id": "rec-taxable", "label": "Schedule C profit carries through to taxable income", "group": "reconcile", "lines": ["Sch1.3", "F1040.11", "F1040.15"], "refs": [], "said": "3 steps", "other": f"{len(bad)} differ" if bad else "all agree"}
        out.append({**tb, "status": "fail", "detail": " ".join(bad)} if bad else {**tb, "status": "pass", "detail": "Schedule 1 business income equals Schedule C net profit, total income less adjustments is adjusted gross income, and that less deductions is taxable income."})
    return out


def cross_checks(index):
    if index._cross is None:
        index._cross = [c for c in [*_payment_checks(index), *_vehicle_checks(index), *_ssn_checks(index), _california_wages(index), _se_health(index), *_pair_checks(index), _form_8949_check(index), *_state_checks(index), *_books_checks(index)] if c]
    return index._cross


def _with_adjusted(c, adjusted):
    """A payment check read against the number as adjusted, not the packet's original. The original stays in the event log."""
    if not c["id"].startswith("pay-") or not is_num(adjusted):
        return c
    total, who = c["agencyTotal"], c["who"]
    if abs(adjusted - total) < 0.5:
        return {**c, "status": "pass", "said": fmt(adjusted), "detail": f"The number now says {fmt(adjusted)} (adjusted) and {who} shows {fmt(total)} (as of {c['asOf']}). They agree."}
    more_less = "less" if adjusted > total else "more"
    return {**c, "status": "fail", "said": fmt(adjusted), "detail": f"The number now says {fmt(adjusted)} (adjusted). {who[0].upper() + who[1:]} shows {fmt(total)} (as of {c['asOf']}), {fmt(abs(adjusted - total))} {more_less}."}


def cross_checks_for(index, key, adjusted=None):
    return [{"id": c["id"], "label": c["label"], "status": c["status"], "detail": c["detail"], "refs": c["refs"], "ref": c["refs"][0] if c["refs"] else None,
             **{k: c[k] for k in ("items", "itemsTitle", "recordId", "other") if k in c}}
            for c in (_with_adjusted(c, adjusted) for c in cross_checks(index) if key in c["lines"])]


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


# ---------- a rejection that names a person: do their Social Security numbers agree? ----------

_SSN = re.compile(r"\d{3}-\d{2}-\d{4}")


def _is_swap(a, b):
    x, y = re.sub(r"\D", "", a), re.sub(r"\D", "", b)
    if len(x) != len(y):
        return False
    diff = [i for i, ch in enumerate(x) if ch != y[i]]
    return len(diff) == 2 and diff[1] == diff[0] + 1 and x[diff[0]] == y[diff[1]] and x[diff[1]] == y[diff[0]]


def ssn_mismatch(packet, message):
    """If the message names someone in the household, compare the number the organizer holds for them with the number
    printed on their Social Security card. Only masked numbers leave this function. None when there is nothing to compare."""
    from mask import mask_number
    person = next((p for p in packet["household"]["people"] if p["name"] in message), None)
    if not person:
        return None
    card = next((d for d in packet["documents"] if d.get("document_type") == "identity_document"
                 and str(d.get("belongs_to")).endswith(f":{person['id']}") and _SSN.search(json.dumps(d.get("pages", "")))), None)
    if not card:
        return None
    card_ssn = _SSN.search(json.dumps(card["pages"])).group(0)
    if card_ssn == person.get("ssn"):
        return None
    value = next((v for v in packet["extracted_values"] if v["document_id"] == card["id"] and re.search("social security", str(v.get("label")), re.I)), None)
    return {"person": person["name"], "organizer": mask_number(person["ssn"]), "card": mask_number(card_ssn), "docId": card["id"],
            "valueRef": value["id"] if value else card["id"], "swapped": _is_swap(person["ssn"], card_ssn)}


def ssn_mismatches(packet):
    efile = (packet.get("tax_agency_records") or {}).get("efile") or []
    out = {}
    for submission in efile:
        for error in submission.get("errors") or []:
            found = ssn_mismatch(packet, error.get("message", ""))
            if found:
                out[error["message"]] = found
    return out


# ---------- tax effect, sign-off state, the return's fingerprint and the client's approval ----------

TAX_EFFECT_CATEGORY = {"F1040.1a": "wages", "F1040.1z": "wages", "SchC.1": "schc_profit"}  # lines with an obvious rate


def tax_effect(index, claim, delta):
    """Estimated tax effect of changing a line by `delta` (the engine cannot be rerun: change times the packet's rate), or None."""
    category = TAX_EFFECT_CATEGORY.get(claim)
    rate = (index.current.get("tax_effect_rates") or {}).get(category) if category else None
    if not rate:
        return None
    return {"category": category, "federal": delta * rate["federal_per_dollar"], "california": delta * rate["california_per_dollar"], "estimated": True}


def signoff_states(index, events):
    """For every line that has a sign-off: {state: 'signed' | 'reopened', now, last}. Lines never signed are left out."""
    out = {}
    for line in index.current["lines"]:
        mine = [e for e in events if e.get("claim") == line["key"]]
        signoffs = [e for e in mine if e.get("type") == "signoff"]
        if not signoffs:
            continue
        last = signoffs[-1]
        now = effective_value(line, events)
        out[line["key"]] = {"state": "signed" if last.get("valueAtSignoff") == now else "reopened", "now": now,
                            "last": {"by": last.get("by"), "at": last.get("at"), "valueAtSignoff": last.get("valueAtSignoff")}}
    return out


def return_fingerprint(index, events):
    """A short fingerprint of every number on the return as it stands now (packet values plus adjustments). FNV-1a, same text for the same numbers."""
    text = "|".join(f"{l['key']}={js_str(effective_value(l, events))}" for l in index.current["lines"] if l["value"] is not None)
    h = 0x811C9DC5
    for ch in map(ord, text):
        h = ((h ^ ch) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}-{len(text)}"


def approval_state(index, events):
    """Where the return is in approval: none | presented | partly | approved | stale (numbers changed after presenting)."""
    signers = [p["name"] for p in index.packet["household"]["people"] if p.get("role") in ("taxpayer", "spouse")]
    fingerprint = return_fingerprint(index, events)
    presents = [e for e in events if e.get("type") == "present"]
    present = presents[-1] if presents else None
    if not present:
        return {"state": "none", "present": None, "signed": [], "missing": signers, "signers": signers, "fingerprint": fingerprint}
    signed = [e for e in events if e.get("type") == "approve" and e.get("presents") == present.get("id")]
    names = {e.get("signer") for e in signed}
    missing = [n for n in signers if n not in names]
    state = "presented"
    if present.get("fingerprint") != fingerprint:
        state = "stale"
    elif not missing:
        state = "approved"
    elif signed:
        state = "partly"
    return {"state": state, "present": present, "signed": signed, "missing": missing, "signers": signers, "fingerprint": fingerprint}


# ---------- firm standards: variance against last year, and reviewing your own work ----------

def swing_note(events, key):
    """The newest note explaining why a line moved against last year (J1), or None."""
    notes = [e for e in events if e.get("type") == "note" and e.get("swing") and e.get("claim") == key
             and len(str(e.get("text") or "").strip()) >= MIN_NOTE]
    return notes[-1] if notes else None


def variance_flags(index, events):
    """Lines whose change against last year breaks the firm's variance rule, biggest change first."""
    rule = index.packet["firm"]["starter_standards"]["variance_review"]
    prior = ((index.packet.get("prior_years") or {}).get("return_2024") or {}).get("lines") or {}
    out = []
    for line in index.current["lines"]:
        if not is_num(line["value"]):
            continue
        last = prior.get(line["key"])
        if not is_num(last):
            continue
        now = effective_value(line, events)
        if not is_num(now):
            continue
        change = now - last
        pct = None if last == 0 else abs(change) / abs(last) * 100  # None = from zero
        if abs(change) > rule["and_over_amount"] and (pct is None or pct > rule["flag_if_change_over_percent"]):
            note = swing_note(events, line["key"])
            out.append({"key": line["key"], "label": line["label"], "now": now, "last": last, "change": round2(change),
                        "pct": pct, "explained": {"text": note["text"], "by": note.get("by")} if note else None})
    return sorted(out, key=lambda f: -abs(f["change"]))


def self_reviews(events):
    """Sign-offs by someone who also adjusted (or amended) the same number. One row per line and person."""
    seen, out = set(), []
    for s in events:
        name = (s.get("by") or {}).get("name")
        if s.get("type") != "signoff" or not name:
            continue
        same = any(e.get("claim") == s.get("claim") and e.get("type") in ("adjust", "amend") and (e.get("by") or {}).get("name") == name for e in events)
        if same and (s["claim"], name) not in seen:
            seen.add((s["claim"], name))
            out.append({"key": s["claim"], "name": name})
    return out


def variance_problem(events, claim):
    """A sentence saying the line moved too far against last year without a written reason, or None."""
    index = load_index()
    if index is None:
        return None
    flag = next((f for f in variance_flags(index, events) if f["key"] == claim), None)
    if flag and not flag["explained"]:
        return (f"This number moved against last year ({fmt(flag['last'])} to {fmt(flag['now'])}), more than the firm allows without a reason. "
                f"Write why it moved (at least {MIN_NOTE} characters) with Explain the change before signing.")
    return None


# ---------- everything at once, for GET /api/checks ----------

def books_bridge_out(index):
    b = books_bridge(index)
    return {"rows": b["rows"], "unexplained": b["unexplained"], "unknown": b["unknown"]} if b else None


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
        claims[line["key"]] = {"worst": worst(checks), "value": effective_value(line, events), "checks": checks}
    # Only problems are sent for the document panel; anything missing from these lists is fine.
    printed = {}
    for vid, value in index.values.items():
        check = printed_match(index, value)
        if check["status"] in ("fail", "warn"):
            printed[vid] = check
    docs, pages = {}, {}
    for doc_id, doc in index.documents.items():
        check = duplicate_doc(index, doc_id)
        if check["status"] == "warn":
            docs[doc_id] = check
        for page in doc["pages"]:
            check = duplicate_page(index, doc_id, page["page"])
            if check["status"] == "warn":
                pages[f"{doc_id}:{page['page']}"] = check
    return {"claims": claims, "cross": cross_checks(index), "income": income_by_category(index),
            "printed": printed, "docs": docs, "pages": pages, "bridge": books_bridge_out(index),
            "ssnMismatch": ssn_mismatches(index.packet),
            "variance": variance_flags(index, events), "selfReviews": self_reviews(events),
            "signoffs": signoff_states(index, events), "approval": approval_state(index, events)}
