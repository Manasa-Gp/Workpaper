"""dump_checks.py - prints the server's checks as JSON (what GET /api/checks sends before anyone has changed anything).
The browser tests use it, so they never need their own copy of the rules.  Run: python3 backend/dump_checks.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from checks import all_checks

print(json.dumps(all_checks([])))
