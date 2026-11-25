# Dev-only static server with CORS for the tile pieces: python3 tiles_server.py <dir> <port>
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*"); super().end_headers()
    def log_message(self, *a): pass
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), partial(H, directory=sys.argv[1])).serve_forever()
