"""search.py — find every record in the packet that contains a keyword.

Why: packet.json is ~2 MB. Instead of scrolling through it, ask for a word and get
back whole records (a document, an extracted value, a client answer, a return line...).

The rule: when the word is found deep inside something, climb up to the nearest
enclosing record and return that whole record. A "record" is an object that has an
"id" (documents D01, values ev-0016, answers qa-14...) or a "key" (return lines).
So a hit inside a page of a document returns the entire document, not just the page.
If nothing above the hit has an id or key, the object that directly holds the matching
text is returned (for example one diagnostics entry), never a whole section.

Use from the terminal (from the repo folder):
    python3 backend/search.py "meridian"             # short summary, one line per record
    python3 backend/search.py "meridian" --full      # the whole records as JSON
    python3 backend/search.py "meridian" --in documents   # only look inside one section

Use from Python:
    from search import find_records
    hits = find_records(packet, "meridian")   # [{"path": "documents/29", "record": {...}}, ...]
"""
import argparse
import json
import sys
from pathlib import Path

PACKET = Path(__file__).resolve().parent / "data" / "packet.json"


def _is_record(node):
    return isinstance(node, dict) and ("id" in node or "key" in node)


def _contains(value, needle):
    """True if a plain value (string, number) holds the keyword. Case-insensitive."""
    return needle in str(value).lower()


def find_records(packet, keyword, section=None):
    """Return [{"path": "documents/29", "record": {...}}] for every record holding the keyword."""
    needle = keyword.lower()
    found = {}  # path -> record, so a record with many hits is returned once

    def walk(node, trail):
        # trail = list of (path_string, node) from the top section down to this node
        if isinstance(node, dict):
            for key, child in node.items():
                if _contains(key, needle) and not isinstance(child, (dict, list)):
                    claim(trail + [(str(key), child)])
                walk(child, trail + [(str(key), child)])
        elif isinstance(node, list):
            for i, child in enumerate(node):
                walk(child, trail + [(str(i), child)])
        elif _contains(node, needle):
            claim(trail)

    def claim(trail):
        # climb from the hit up to the nearest enclosing record
        for depth in range(len(trail) - 1, 0, -1):
            if _is_record(trail[depth][1]):
                break
        else:
            # nothing above has an id or key: return the object that directly holds the matching text
            depth = max(len(trail) - 2, 0)
            holder = trail[depth][1]
            if isinstance(holder, dict):  # keep only its plain fields, so a whole return version is not dumped
                holder = {k: v for k, v in holder.items() if not isinstance(v, (dict, list))}
            found["/".join(p for p, _ in trail[: depth + 1])] = holder
            return
        found["/".join(p for p, _ in trail[: depth + 1])] = trail[depth][1]

    sections = [section] if section else list(packet.keys())
    for name in sections:
        if name in packet:
            walk(packet[name], [(name, packet[name])])
    return [{"path": path, "record": record} for path, record in found.items()]


def _label(record):
    if not isinstance(record, dict):
        return type(record).__name__
    ident = record.get("id") or record.get("key") or ""
    title = record.get("title") or record.get("label") or record.get("question") or ""
    return f"{ident} {title}".strip()


def main():
    parser = argparse.ArgumentParser(description="Find packet records that contain a keyword.")
    parser.add_argument("keyword")
    parser.add_argument("--in", dest="section", help="only search one top-level section, e.g. documents")
    parser.add_argument("--full", action="store_true", help="print the whole records as JSON")
    args = parser.parse_args()

    packet = json.loads(PACKET.read_text())
    hits = find_records(packet, args.keyword, args.section)
    if args.full:
        json.dump(hits, sys.stdout, indent=2, ensure_ascii=False)
        print()
    else:
        for hit in hits:
            print(f"{hit['path']:<32} {_label(hit['record'])}")
    print(f"\n{len(hits)} record(s) contain {args.keyword!r}.", file=sys.stderr)


if __name__ == "__main__":
    main()
