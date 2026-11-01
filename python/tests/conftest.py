import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Union
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

REPO = Path(__file__).resolve().parents[3]


class Recorded:
    def __init__(self, method: str, path: str, query: List[Any], headers: Dict[str, str], body: Any) -> None:
        self.method = method
        self.path = path
        self.query = query
        self.headers = headers
        self.body = body

    @property
    def query_dict(self) -> Dict[str, str]:
        return dict(self.query)


Reply = Dict[str, Any]
Responder = Callable[[Recorded, int], Reply]


class FakeServer:
    """A local HTTP server that records requests and answers from a script (list or function)."""

    def __init__(self) -> None:
        self.requests: List[Recorded] = []
        self.responder: Union[List[Reply], Responder] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # silence
                pass

            def _handle(self) -> None:
                parts = urlsplit(self.path)
                length = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(length) if length else b""
                body = json.loads(raw) if raw else None
                rec = Recorded(self.command, parts.path, parse_qsl(parts.query), {k.lower(): v for k, v in self.headers.items()}, body)
                server.requests.append(rec)
                i = len(server.requests) - 1
                r = server.responder(rec, i) if callable(server.responder) else server.responder[i]
                if r.get("drop"):
                    # Close without answering: the client sees a network error.
                    self.close_connection = True
                    self.connection.shutdown(2)
                    return
                payload = r.get("raw", json.dumps(r.get("body", {})).encode())
                if isinstance(payload, str):
                    payload = payload.encode()
                self.send_response(r.get("status", 200))
                headers = {"content-type": "application/json", "request-id": f"req_{i + 1}", **r.get("headers", {})}
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = do_POST = do_DELETE = _handle

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def script(self, responder: Union[List[Reply], Responder]) -> "FakeServer":
        self.requests = []
        self.responder = responder
        return self

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture()
def fake() -> Any:
    s = FakeServer()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHECKBOX_API_KEY", raising=False)
    monkeypatch.delenv("CHECKBOX_SECRET_KEY", raising=False)
    monkeypatch.delenv("CHECKBOX_API_BASE", raising=False)


@pytest.fixture(autouse=True)
def _fast_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    import checkbox._client as c

    monkeypatch.setattr(c, "_backoff", lambda attempt: 0.01)


def error_body(type_: str, code: str, message: str = "boom", **extra: Any) -> Dict[str, Any]:
    return {"error": {"type": type_, "code": code, "message": message, "doc_url": f"https://checkbox.site/docs/api/errors#{code}", "request_id": "req_err", **extra}}


# ---- the real API (apps/api), started once per session ----------------------------------------------------------

class LiveApi:
    def __init__(self) -> None:
        pnpm = shutil.which("pnpm")
        if not pnpm or not (REPO / "apps/api/src/testing/serve-sdk-api.ts").exists():
            pytest.skip("pnpm / the Checkbox monorepo is not available")
        self.proc = subprocess.Popen(
            [pnpm, "exec", "tsx", "apps/api/src/testing/serve-sdk-api.ts"],
            cwd=REPO,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            env={**os.environ, "NODE_ENV": "test"},
        )
        line = self.proc.stdout.readline()  # type: ignore[union-attr]
        info = json.loads(line) if line.strip() else {"error": "the API server exited without output"}
        if "error" in info:
            self.close()
            pytest.skip(f"real API unavailable: {info['error']}")
        self.url = info["url"]
        self.test_key = info["test_key"]
        self.live_key = info["live_key"]

    def sweep(self):
        self.proc.stdin.write("sweep\n")  # type: ignore[union-attr]
        self.proc.stdin.flush()  # type: ignore[union-attr]
        return json.loads(self.proc.stdout.readline())["deliveries"]  # type: ignore[union-attr]

    def close(self) -> None:
        try:
            self.proc.stdin.close()  # type: ignore[union-attr]
            self.proc.wait(timeout=20)
        except Exception:
            self.proc.kill()


@pytest.fixture(scope="session")
def api():
    server = LiveApi()
    yield server
    server.close()


@pytest.fixture(scope="session")
def cb(api):
    from checkbox import Checkbox

    return Checkbox(api.test_key, base_url=api.url, max_network_retries=0)


