"""backend/server.py - the whole backend. Standard library only; needs Python 3.8+.

Run:  python3 backend/server.py        then open http://localhost:3000

What it does
  GET  /api/packet   sends backend/data/packet.json exactly as it is on disk (never modified)
  GET  /api/events   sends the saved notes / adjustments / sign-offs (backend/data/events.json)
  PUT  /api/events   replaces that list with the one in the request body
  anything else      serves the files in ../frontend, so one command runs the whole app

Where the data goes
  backend/data/packet.json   <- YOU PUT THE PACKET HERE
  backend/data/events.json   <- created by the app on the first save
"""
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import threading

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
FRONTEND = (HERE.parent / "frontend").resolve()
PACKET = DATA / "packet.json"
EVENTS = DATA / "events.json"
PORT = int(os.environ.get("PORT", 3000))
HOST = os.environ.get("HOST", "127.0.0.1")  # on a host, set HOST=0.0.0.0 so outside visitors can connect
MAX_BODY = 5_000_000
LOCK = threading.Lock()

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


class Handler(BaseHTTPRequestHandler):
    # --- helpers -----------------------------------------------------------
    def send(self, status, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, obj):
        self.send(status, json.dumps(obj))

    # --- GET: the API, then the frontend files -----------------------------
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/packet":
            if not PACKET.exists():
                return self.send_json(404, {"error": "Put packet.json in backend/data/"})
            return self.send(200, PACKET.read_bytes())
        if path == "/api/events":
            return self.send(200, EVENTS.read_bytes() if EVENTS.exists() else "[]")
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "unknown endpoint"})
        self.serve_frontend(path)

    def serve_frontend(self, path):
        wanted = "index.html" if path == "/" else path.lstrip("/")
        file = (FRONTEND / wanted).resolve()
        if FRONTEND not in file.parents:          # blocks ../ tricks
            return self.send(403, "forbidden", "text/plain")
        if not file.is_file():
            return self.send(404, "not found", "text/plain")
        kind = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if kind.startswith("text/") or kind == "application/json":
            kind += "; charset=utf-8"
        self.send(200, file.read_bytes(), kind)

    # --- PUT: save the events list -----------------------------------------
    def do_PUT(self):
        if unquote(urlparse(self.path).path) != "/api/events":
            return self.send_json(404, {"error": "unknown endpoint"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self.send_json(413, {"error": "too large"})
        try:
            events = json.loads(self.rfile.read(length))
        except ValueError:
            return self.send_json(400, {"error": "not JSON"})
        if not isinstance(events, list):
            return self.send_json(400, {"error": "expected a list"})
        DATA.mkdir(parents=True, exist_ok=True)
        EVENTS.write_text(json.dumps(events, indent=2), encoding="utf-8")
        self.send_json(200, {"ok": True})
    def do_POST(self):
        if unquote(urlparse(self.path).path) != "/api/events":
            return self.send_json(404, {"error": "unknown endpoint"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self.send_json(413, {"error": "too large"})
        try:
            event = json.loads(self.rfile.read(length))
        except ValueError:
            return self.send_json(400, {"error": "not JSON"})
        if not isinstance(event, dict) or not event.get("claim") or not event.get("type"):
            return self.send_json(400, {"error": "expected an event with claim and type"})
        with LOCK:
            events = json.loads(EVENTS.read_text(encoding="utf-8")) if EVENTS.exists() else []
            events.append(event)
            DATA.mkdir(parents=True, exist_ok=True)
            EVENTS.write_text(json.dumps(events, indent=2), encoding="utf-8")
        self.send_json(200, {"ok": True, "count": len(events)})

    def log_message(self, fmt, *args):            # keep the terminal quiet
        pass



if __name__ == "__main__":
    print(f"Trail running at http://localhost:{PORT}")
    print("Packet found." if PACKET.exists() else "No packet yet: put packet.json in backend/data/")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
