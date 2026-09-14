#!/usr/bin/env python3
"""CyberGuard Academy — server statis minimal dengan security headers lengkap.

Jalankan:
    python3 serve.py [port]   # default 8080

Semua response diberi header keamanan (CSP, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permission-Policy) untuk
menutup vektor clickjacking, MIME-sniffing, dan pelacakan referer.

Catatan: GitHub Pages tidak mengirim header kustom. Untuk deploy dengan
header penuh, gunakan host yang mendukung custom headers (mis. Netlify /
Cloudflare Pages) dan file `_headers` yang tersedia di proyek ini.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permission-Policy": (
        "camera=(), microphone=(), geolocation=(), "
        "payment=(), usb=(), interest-cohort=()"
    ),
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("[cyberguard] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("CyberGuard Academy di http://localhost:%d  (security headers AKTIF)" % port)
    print("  CSP          : Content-Security-Policy")
    print("  Clickjacking : X-Frame-Options: DENY")
    print("  MIME sniff   : X-Content-Type-Options: nosniff")
    print("  Referrer     : Referrer-Policy: no-referrer")
    print("  Permission   : Permission-Policy: semua API pemrofilan dimatikan")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")


if __name__ == "__main__":
    main()