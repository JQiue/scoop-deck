#!/usr/bin/env python3
"""Mock Scoop URL manifests and throttled zips for ScoopDeck UI testing.

    python scripts/mock-scoop.py

Serves `/<app>.json` and `/<app>-<version>.zip` on 127.0.0.1:8765. Apps are
created at 0.1.0 in memory on first use. Nothing is written to disk; stop with
Ctrl+C. Edit RATE_KIB or DEFAULT_SIZE below to change the test download.
"""

from __future__ import annotations

import hashlib
import io
import json
import random
import re
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8765
# Download speed, in KiB/s.
RATE_KIB = 256
# Generated zip payload size, in bytes.
DEFAULT_SIZE = 10 * 1024 * 1024
ZIP_DATE = (2020, 1, 1, 0, 0, 0)
APP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
ZIP_RE = re.compile(r"^(?P<app>.+)-(?P<version>\d+\.\d+\.\d+)\.zip$")
RESERVED = {"state", "favicon", "health"}

# The whole mock state: the serve process owns it in memory.
APPS: dict[str, dict] = {}
APPS_LOCK = threading.Lock()
HASH_CACHE: dict[tuple[str, str, int], str] = {}
HASH_LOCK = threading.Lock()


def valid_app(name: str) -> bool:
    return bool(APP_RE.fullmatch(name)) and name.lower() not in RESERVED


def ensure_app(name: str) -> dict:
    """The app's state, created at 0.1.0 on first use."""
    with APPS_LOCK:
        info = APPS.get(name)
        if info is None:
            info = {"version": "0.1.0", "size": DEFAULT_SIZE}
            APPS[name] = info
        return dict(info)


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def zip_bytes(app: str, version: str, size: int) -> bytes:
    seed = int(hashlib.sha256(f"{app}:{version}".encode()).hexdigest()[:16], 16)
    payload = random.Random(seed).randbytes(max(size - 200, 1))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for entry, data in (
            (f"{app}/README.txt", f"Mock app {app} {version}.\n".encode()),
            (f"{app}/data.bin", payload),
        ):
            info = zipfile.ZipInfo(entry, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
    return buffer.getvalue()


def manifest(app: str, info: dict, port: int) -> dict:
    key = (app, info["version"], info["size"])
    with HASH_LOCK:
        digest = HASH_CACHE.get(key)
        if digest is None:
            digest = sha256(zip_bytes(app, info["version"], info["size"]))
            HASH_CACHE[key] = digest
    return {
        "version": info["version"],
        "description": f"Mock download target for ScoopDeck ({app})",
        "homepage": "https://example.com/",
        "license": "MIT",
        "url": f"http://{HOST}:{port}/{app}-{info['version']}.zip",
        "hash": digest,
        "notes": "Mock app for ScoopDeck UI testing; no executables inside.",
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    generated: dict[tuple[str, str, int], bytes] = {}
    generated_lock = threading.Lock()

    def do_GET(self) -> None:
        self.respond(True)

    def do_HEAD(self) -> None:
        self.respond(False)

    def respond(self, body: bool) -> None:
        path = self.path.split("?", 1)[0].strip("/")
        port = self.server.server_address[1]

        if path.endswith(".json"):
            app = path[:-5]
            if not valid_app(app):
                self.send_error(404, "Not found")
                return
            data = json.dumps(manifest(app, ensure_app(app), port)).encode()
            self.send_data(data, "application/json", body)
            return

        match = ZIP_RE.fullmatch(path)
        if not match:
            self.send_error(404, "Not found")
            return
        app = match["app"]
        version = match["version"]
        if not valid_app(app):
            self.send_error(404, "Not found")
            return

        info = ensure_app(app)
        key = (app, version, info["size"])
        with self.generated_lock:
            data = self.generated.get(key)
            if data is None:
                data = zip_bytes(app, version, info["size"])
                self.generated[key] = data
        self.send_data(data, "application/zip", body)

    def send_data(self, data: bytes, content_type: str, body: bool) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not body:
            return

        rate = RATE_KIB * 1024
        chunk_size = 16 * 1024
        for start in range(0, len(data), chunk_size):
            try:
                self.wfile.write(data[start : start + chunk_size])
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return
            if rate:
                time.sleep(min(chunk_size, len(data) - start) / rate)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


class QuietServer(ThreadingHTTPServer):
    """A client that closes its polling connection is not an error worth a traceback."""

    def handle_error(self, request, client_address) -> None:
        error = sys.exc_info()[1]
        if isinstance(
            error, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)
        ):
            return
        super().handle_error(request, client_address)


def main() -> int:
    server = QuietServer((HOST, PORT), Handler)
    print(f"Serving http://{HOST}:{PORT} at {RATE_KIB} KiB/s; state is in memory")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
