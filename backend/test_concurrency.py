"""test_concurrency.py - several people saving at once must not lose or mix up events.

Run:  python3 backend/test_concurrency.py
It copies the backend to a temporary folder, starts a private server there (your real
events.json is never touched), sends many events from many threads at the same moment, and
checks that every single one was saved exactly once.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = 3917
BASE = f"http://127.0.0.1:{PORT}"


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


def main():
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(HERE, tmp / "backend", ignore=shutil.ignore_patterns("__pycache__", "events.json", "views.json", ".DS_Store"))
    shutil.copytree(HERE.parent / "frontend", tmp / "frontend", ignore=shutil.ignore_patterns(".git", "test"))
    server = subprocess.Popen([sys.executable, str(tmp / "backend" / "server.py")], env={**os.environ, "PORT": str(PORT)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                get("/api/events?role=Partner")
                break
            except OSError:
                time.sleep(0.1)
        people = [("Preparer", "note"), ("Reviewer", "note"), ("Partner", "note"), ("Preparer", "note"), ("Reviewer", "note")]
        per_thread = 12
        results = []

        def work(i):
            role, kind = people[i]
            for n in range(per_thread):
                results.append(post("/api/events", {"id": f"t{i}-{n}", "at": "t", "claim": "L", "type": kind, "text": "x", "by": {"name": role, "role": role}}))

        threads = [threading.Thread(target=work, args=(i,)) for i in range(len(people))]
        [t.start() for t in threads]
        [t.join() for t in threads]
        saved = get("/api/events?role=Partner")
        ids = [e["id"] for e in saved]
        total = len(people) * per_thread
        assert all(code in (200, 201, 204) for code in results), f"some saves failed: {set(results)}"
        assert len(ids) == total, f"expected {total} events, found {len(ids)} (events were lost)"
        assert len(set(ids)) == total, "duplicate events"

        # the same sign-off sent twice at the same moment: exactly one may win
        signoff = {"at": "t", "claim": "M", "type": "signoff", "valueAtSignoff": 5, "by": {"name": "R", "role": "Reviewer"}}
        codes = []
        pair = [threading.Thread(target=lambda k=k: codes.append(post("/api/events", {**signoff, "id": f"so-{k}"}))) for k in range(2)]
        [t.start() for t in pair]
        [t.join() for t in pair]
        assert sorted(c in (200, 201, 204) for c in codes) == [False, True], f"two simultaneous sign-offs: {codes}"
        print("concurrency ok")
    finally:
        server.terminate()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
