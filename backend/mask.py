"""mask.py - hides sensitive numbers (SSNs, PINs, bank numbers) before the packet leaves the server.

GET /api/packet always sends the masked packet. Only GET /api/reveal can send a real record, and only to a
role the firm has cleared (sensitive_data_clearance in the packet). Every reveal is written to the view log.

Two ways a secret can appear:
  1. under a field whose name says what it is  ->  {"ssn": "666-74-3309"}
  2. inside a sentence                          ->  "Taxpayer PIN 41207"
"""
import re

LAST_FOUR = {"ssn", "routing", "account", "ptin", "ptins"}  # the last four digits stay, like a card statement
HIDE_ALL = {"ip_pin", "ero_pin", "pin"}                     # a PIN is a password: no digits stay
SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
PIN = re.compile(r"(\bPIN\s+)\d+", re.I)

# Which firm staff member each role of the page is (same table as frontend/src/roles.js).
ROLE_STAFF = {"preparer": "st-01", "preparer2": "st-04", "reviewer": "st-02", "partner": "st-03", "quality": "st-06", "admin": "st-05"}
ROLE_LABEL = {"preparer": "Preparer", "preparer2": "Preparer", "reviewer": "Reviewer", "partner": "Partner", "quality": "Quality reviewer", "admin": "Administrator"}


def dots(n):
    return "•" * n


def mask_number(value):
    """'666-74-3309' -> '•••-••-3309'; '4483019276' -> '••••••9276'; short values are hidden entirely."""
    s = str(value)
    if re.fullmatch(r"\d{3}-\d{2}-\d{4}", s):
        return f"•••-••-{s[-4:]}"
    return dots(len(s)) if len(s) <= 4 else dots(len(s) - 4) + s[-4:]


def mask_text(text):
    """Masks secrets written inside a sentence: SSNs, and any number after the word PIN."""
    return PIN.sub(lambda m: m.group(1) + dots(6), SSN.sub(lambda m: mask_number(m.group(0)), str(text)))


def mask_deep(value, key=""):
    """A masked copy of any value (dict, list, text). The original is not touched."""
    name = key.lower()
    if value is None:
        return value
    if isinstance(value, list):
        return [mask_deep(v, key) for v in value]
    if isinstance(value, dict):
        return {k: mask_deep(v, k) for k, v in value.items()}
    if name in HIDE_ALL:
        return dots(6)
    if name in LAST_FOUR:
        return mask_number(value)
    return mask_text(value) if isinstance(value, str) else value


def cleared(packet, role_key):
    """May this role see real sensitive numbers? Only staff the packet marks as cleared."""
    staff_id = ROLE_STAFF.get(role_key)
    if not staff_id:
        return False
    return any(s.get("id") == staff_id and s.get("sensitive_data_clearance") is True for s in packet["firm"]["staff"])


def staff_name(packet, role_key):
    staff_id = ROLE_STAFF.get(role_key)
    return next((s["name"] for s in packet["firm"]["staff"] if s.get("id") == staff_id), ROLE_LABEL.get(role_key, ""))


def resolve_pointer(root, pointer):
    """RFC 6901 JSON Pointer, e.g. '/return_2024/lines/F8606.14'."""
    node = root
    for raw in pointer.split("/")[1:]:
        part = raw.replace("~1", "/").replace("~0", "~")
        try:
            node = node[int(part)] if isinstance(node, list) else node[part]
        except (KeyError, IndexError, ValueError, TypeError):
            return None
    return node


def find_record(packet, ref):
    """The real (unmasked) record a source reference points to, for the kinds that can hold secrets. None if not found."""
    if ref.startswith("py:"):
        return resolve_pointer(packet["prior_years"], ref[3:])
    if ref.startswith("agency:"):
        return resolve_pointer(packet["tax_agency_records"], ref[7:])
    if ref.startswith("ref:param."):
        return packet["engine_reference"]["parameters"].get(ref[len("ref:param."):])
    if ref.startswith("asset:"):
        asset_id = ref[6:]
        current = packet["return_versions"][-1]
        pool = (current.get("assets") or []) + (packet["prior_years"].get("asset_records") or [])
        return next((a for a in pool if a.get("asset_id") == asset_id), None)
    if ref.startswith("household:"):
        return next((p for p in packet["household"]["people"] if p["id"] == ref[len("household:"):]), None)
    if ref.startswith("timeline:"):
        return next((t for t in packet["timeline"] if t["id"] == ref[len("timeline:"):]), None)
    return None
