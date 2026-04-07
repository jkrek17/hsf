#!/usr/bin/env python3
"""
Serve this project root over HTTP (needed for ES modules + import maps).

  python3 serve.py

Open http://127.0.0.1:5173/

Live forecast text is loaded in the browser from https://api.weather.gov (CORS allowed).
Archive browsing uses the Iowa Environmental Mesonet (IEM) JSON endpoints.
"""

from __future__ import annotations

import http.server
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        from urllib.parse import urlparse

        parsed = urlparse(self.path)
        if parsed.path == "" or parsed.path == "/":
            self.path = "/index.html" + (("?" + parsed.query) if parsed.query else "")
        return super().do_GET()

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    port = 5173
    with http.server.HTTPServer(("", port), Handler) as httpd:
        print(f"Serving {ROOT} at http://127.0.0.1:{port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
