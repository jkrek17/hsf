#!/usr/bin/env python3
"""
Local static server for the forecast viewer with an OPC reverse proxy.

Run from this directory:
  python3 serve.py

Then open http://127.0.0.1:5173/

Requests to /opc/* are forwarded to https://ocean.weather.gov/* so the
browser can load live forecasts without CORS errors.
"""

from __future__ import annotations

import http.client
import http.server
import ssl
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OPC_HOST = "ocean.weather.gov"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "" or parsed.path == "/":
            self.path = "/index.html" + (
                ("?" + parsed.query) if parsed.query else ""
            )
            parsed = urllib.parse.urlparse(self.path)

        if parsed.path.startswith("/opc"):
            self._proxy_opc(parsed)
            return
        return super().do_GET()

    def _proxy_opc(self, parsed):
        target = parsed.path[4:] or "/"
        if not target.startswith("/"):
            target = "/" + target
        if parsed.query:
            target += "?" + parsed.query
        try:
            ctx = ssl.create_default_context()
            conn = http.client.HTTPSConnection(OPC_HOST, context=ctx, timeout=60)
            conn.request(
                "GET",
                target,
                headers={
                    "User-Agent": "forecast-viewer-local/1.0",
                    "Accept": "text/plain,*/*",
                },
            )
            resp = conn.getresponse()
            body = resp.read()
            conn.close()
            self.send_response(resp.status)
            for h, v in resp.getheaders():
                hl = h.lower()
                if hl in ("transfer-encoding", "connection", "content-encoding"):
                    continue
                self.send_header(h, v)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_error(502, f"OPC proxy: {e}")

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    port = 5173
    with http.server.HTTPServer(("", port), Handler) as httpd:
        print(f"Serving {ROOT} at http://127.0.0.1:{port}/")
        print("OPC proxy: /opc/... -> https://ocean.weather.gov/...")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
