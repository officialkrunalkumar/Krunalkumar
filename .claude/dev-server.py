"""Zero-dependency local dev server that mimics Vercel's clean URLs.

Serves /about as about.html, / as index.html, and unmatched paths as 404.html —
matching the "cleanUrls": true behavior in vercel.json. Python stdlib only.

Usage: python .claude/dev-server.py [port]
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CleanURLHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_head(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path.endswith("/"):
            path = path[:-1] or "/"
        if path == "/":
            self.path = "/index.html"
        else:
            candidate = os.path.join(ROOT, path.lstrip("/"))
            if not os.path.isfile(candidate) and os.path.isfile(candidate + ".html"):
                self.path = path + ".html"
            elif not os.path.exists(candidate):
                self.path = "/404.html"
        return super().send_head()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), CleanURLHandler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{port}")
        httpd.serve_forever()
