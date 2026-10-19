"""test_parity.py - the server's checks (checks.py) must give the same answers as the browser's (frontend/src/checks.js).

Run:  python3 backend/test_parity.py
It asks node to print every claim's checks, builds the same list in Python, and compares them one by one.
Needs node. Without it the test says so and stops (exit code 0 only if everything matched).
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import checks  # noqa: E402

if not shutil.which("node"):
    print("node not found: cannot compare with the browser's checks")
    sys.exit(1)

js = json.loads(subprocess.run(["node", str(HERE.parent / "frontend" / "test" / "dump_checks.mjs")], check=True, capture_output=True, text=True).stdout)
index = checks.load_index()


def slim(c):
    return {"id": c["id"], "status": c["status"], "detail": c["detail"], "verify": bool(c.get("verify")), "verifyKey": c.get("verifyKey"), "ref": c.get("ref")}


bad = []
compared = 0
for variant, adjust in (("plain", 0), ("adjusted", 1)):
    for key, expected in js[variant].items():
        line = index.by_key[key]
        got = [slim(c) for c in checks.claim_checks(index, checks.trace_claim(index, key), line["value"] + adjust if adjust else None)]
        compared += 1
        if got != expected:
            bad.append((variant, key, expected, got))

cross = [{"id": c["id"], "status": c["status"], "detail": c["detail"], "lines": c["lines"], "refs": c["refs"]} for c in checks.cross_checks(index)]
if cross != js["cross"]:
    bad.append(("cross", "-", js["cross"], cross))

for variant, key, expected, got in bad[:5]:
    print(f"DIFFERENT {variant} {key}")
    for a, b in zip(expected, got):
        if a != b:
            print("  browser:", a)
            print("  server :", b)
    if len(expected) != len(got):
        print(f"  browser has {len(expected)} checks, server has {len(got)}")
print(f"compared {compared} lists of checks and {len(cross)} cross-checks; {len(bad)} differ")
sys.exit(1 if bad else 0)
