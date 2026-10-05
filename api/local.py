"""Serve api/handler.py locally: python -m api.local [port]  (default 3840)."""
from __future__ import annotations

import base64
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.handler import handler  # noqa: E402


class H(BaseHTTPRequestHandler):
    def _go(self, method: str):
        u = urlsplit(self.path)
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n) if n else b""
        binary = (self.headers.get("content-type") or "").startswith("image/")
        event = {
            "rawPath": u.path,
            "queryStringParameters": dict(parse_qsl(u.query)) or None,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body": base64.b64encode(raw).decode() if binary else raw.decode("utf-8", "replace"),
            "isBase64Encoded": binary,
            "requestContext": {"http": {"method": method, "sourceIp": self.client_address[0]}},
        }
        r = handler(event)
        body = r.get("body") or ""
        data = base64.b64decode(body) if r.get("isBase64Encoded") else body.encode()
        self.send_response(r["statusCode"])
        for k, v in (r.get("headers") or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._go("GET")

    def do_POST(self):
        self._go("POST")

    def do_OPTIONS(self):
        self._go("OPTIONS")

    def log_message(self, fmt, *args):
        sys.stderr.write("api " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3840
    print(f"Dialed API on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
