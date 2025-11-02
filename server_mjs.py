from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os

class MJSHandler(SimpleHTTPRequestHandler):
    # Force correct MIME types for modules (overrides OS/registry defaults)
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "application/javascript",
        ".js":  "application/javascript",
        ".json":"application/json",
        "":     "application/octet-stream",
    }

    # Optional: disable caching while developing
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

if __name__ == "__main__":
    # Ensure we serve from the folder that contains this script
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = 5500
    print(f"Serving {os.getcwd()} on http://localhost:{port}")
    ThreadingHTTPServer(("localhost", port), MJSHandler).serve_forever()