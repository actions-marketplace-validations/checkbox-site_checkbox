"""The Checkbox client (stdlib only: urllib)."""
import json
import os
import platform
import random
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, Mapping, Optional, Tuple

from . import webhook as _webhook
from ._resource import CheckboxFile, CheckboxObject, ListObject, RequestOptions, ResponseMeta
from ._resources import OPERATIONS, RESOURCES, ResourceNamespaces
from ._version import VERSION
from .errors import APIConnectionError, AuthenticationError, CheckboxError, InvalidRequestError, error_from_response
from .types import API_VERSION

DEFAULT_BASE_URL = "https://app.checkbox.site"
DEFAULT_TIMEOUT = 80.0
DEFAULT_MAX_NETWORK_RETRIES = 2
MAX_RETRY_DELAY = 20.0

_KEY_MODE = re.compile(r"^(?:ckr|ck|rk|sk|pk)_(test|live)_")

#: (method, url, headers, body, timeout) -> (status, headers, body bytes). Raise OSError/URLError on network failure.
Transport = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, Dict[str, str], bytes]]


def mode_of_key(key: Optional[str]) -> Optional[str]:
    """``"test"`` for ck_test_/rk_test_/pk_test_ keys, ``"live"`` for live keys, None otherwise."""
    m = _KEY_MODE.match(key or "")
    return m.group(1) if m else None


def _urllib_transport(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float) -> Tuple[int, Dict[str, str], bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 - URL is built from the configured base
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() or b""


class _Webhooks:
    construct_event = staticmethod(_webhook.construct_event)
    verify_header = staticmethod(_webhook.verify_header)
    generate_test_header = staticmethod(_webhook.generate_test_header)


class Checkbox(ResourceNamespaces):
    """Checkbox API client.

    >>> from checkbox import Checkbox
    >>> checkbox = Checkbox()  # reads CHECKBOX_API_KEY
    >>> site = checkbox.sites.create(url="https://acme.example")
    >>> for finding in checkbox.findings.list(site=site["id"]).auto_paging_iter():
    ...     print(finding["check_id"], finding["status"])
    """

    VERSION = VERSION
    API_VERSION = API_VERSION
    webhooks = _Webhooks()

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        api_version: Optional[str] = None,
        max_network_retries: int = DEFAULT_MAX_NETWORK_RETRIES,
        timeout: float = DEFAULT_TIMEOUT,
        app_info: Optional[Mapping[str, str]] = None,
        headers: Optional[Mapping[str, str]] = None,
        transport: Optional[Transport] = None,
    ) -> None:
        """
        :param api_key: secret (``ck_test_…`` / ``ck_live_…``), restricted (``rk_…``) or legacy (``sk_live_…``) key.
            Defaults to the ``CHECKBOX_API_KEY`` environment variable, then ``CHECKBOX_SECRET_KEY`` (written by ``checkbox init``).
        :param base_url: API origin (default ``CHECKBOX_API_BASE`` or https://app.checkbox.site).
        :param api_version: ``Checkbox-Version`` to pin (default: the version this SDK was generated for).
        :param max_network_retries: retries on network errors, 409 idempotency_key_in_use, 429 and 5xx (default 2).
        :param timeout: per-attempt timeout in seconds (default 80).
        :param app_info: ``{"name": ..., "version": ..., "url": ...}`` added to the User-Agent.
        :param transport: replaces urllib (tests, custom proxies).
        """
        key = api_key if api_key is not None else (os.environ.get("CHECKBOX_API_KEY") or os.environ.get("CHECKBOX_SECRET_KEY"))
        self._api_key: Optional[str] = key.strip() if key and key.strip() else None
        # Round-4 pilot: accept the base URL with or without /v1 (the dashboard shows it with /v1).
        self.base_url = re.sub(r"/v1$", "", (base_url or os.environ.get("CHECKBOX_API_BASE") or DEFAULT_BASE_URL).rstrip("/"), flags=re.IGNORECASE)
        self.api_version = api_version or API_VERSION
        self.max_network_retries = max(0, int(max_network_retries))
        self.timeout = float(timeout)
        self._headers = dict(headers or {})
        self._transport: Transport = transport or _urllib_transport
        #: ``"test"`` or ``"live"`` from the key prefix (None without a recognised key).
        self.mode = mode_of_key(self._api_key)
        ua = f"checkbox-python/{VERSION} python/{platform.python_version()}"
        if app_info and app_info.get("name"):
            ua += f" {app_info['name']}" + (f"/{app_info['version']}" if app_info.get("version") else "")
            if app_info.get("url"):
                ua += f" ({app_info['url']})"
        self._user_agent = ua
        for namespace, cls in RESOURCES.items():
            setattr(self, namespace, cls(self))

    def __repr__(self) -> str:
        return f"Checkbox(mode={self.mode!r}, base_url={self.base_url!r}, api_version={self.api_version!r})"

    @property
    def livemode(self) -> Optional[bool]:
        return None if self.mode is None else self.mode == "live"

    # ---- generic calls ---------------------------------------------------------------------------------------------

    def call(self, operation_id: str, args: Optional[Mapping[str, Any]] = None, *, request_options: Optional[RequestOptions] = None, **kwargs: Any) -> Any:
        """Calls any operation by its operationId with flat arguments (path parameters and params together), the
        shape MCP tools and agents use: ``checkbox.call("retrieveSite", {"site": "site_…"})``."""
        op = OPERATIONS.get(operation_id)
        if op is None:
            raise InvalidRequestError(f'Unknown operation "{operation_id}".', type="invalid_request_error", code="route_not_found", param="operation_id")
        rest: Dict[str, Any] = dict(args or {})
        rest.update(kwargs)
        path_args = tuple(rest.pop(name, None) for name in op["path_params"])
        return self._send(operation_id, path_args, rest, request_options)  # type: ignore[arg-type]

    def request(self, method: str, path: str, params: Optional[Mapping[str, Any]] = None, *, request_options: Optional[RequestOptions] = None) -> Any:
        """Raw request to any API path (escape hatch for endpoints newer than this SDK). ``params`` go to the query
        string for GET/DELETE and to the JSON body for POST."""
        op = {
            "operation_id": "request",
            "http_method": method.upper(),
            "path": path if path.startswith("/") else "/" + path,
            "path_params": (),
            "query_params": (),
            "body": method.upper() == "POST",
            "idempotent": method.upper() == "POST",
            "auth": True,
            "response": "json",
            "list": False,
            "paginated": False,
        }
        return self._send_op(op, (), dict(params or {}), request_options)

    # ---- transport -------------------------------------------------------------------------------------------------

    def _send(self, operation_id: str, path_args: Tuple[Any, ...], params: Dict[str, Any], request_options: Optional[RequestOptions]) -> Any:
        return self._send_op(OPERATIONS[operation_id], path_args, params, request_options)

    def _send_op(self, op: Mapping[str, Any], path_args: Tuple[Any, ...], params: Dict[str, Any], request_options: Optional[RequestOptions]) -> Any:
        options: Dict[str, Any] = dict(request_options or {})
        api_key = options.get("api_key") or self._api_key
        if op["auth"] and not api_key:
            raise AuthenticationError(
                "No API key provided. Pass it to Checkbox(api_key) or set CHECKBOX_API_KEY (or CHECKBOX_SECRET_KEY, which `checkbox init` writes).",
                type="authentication_error",
                code="api_key_missing",
                next_action={
                    "type": "get_api_key",
                    "message": "Get a free test key: POST /v1/device/authorize (one browser approval creates an account and test keys), the remote MCP server https://app.checkbox.site/mcp (setup_checkbox), "
                    "or create a key at https://app.checkbox.site/settings/api-keys.",
                    "url": "https://app.checkbox.site/settings/api-keys",
                },
            )
        path = op["path"]
        for name, value in zip(op["path_params"], path_args + (None,) * (len(op["path_params"]) - len(path_args))):
            if not isinstance(value, str) or not value.strip():
                raise InvalidRequestError(
                    f'Missing required path parameter "{name}" for {op["operation_id"]}.',
                    type="invalid_request_error",
                    code="parameter_missing",
                    param=name,
                )
            path = path.replace("{" + name + "}", urllib.parse.quote(value, safe=""))

        query: list = []  # type: ignore[type-arg]
        body: Dict[str, Any] = {}
        query_names = set(op["query_params"])
        for k, v in params.items():
            if v is None:
                continue
            in_query = op["http_method"] != "POST" or k in query_names
            if not in_query:
                body[k] = v
                continue
            if k in ("expand", "expand[]"):
                for e in v if isinstance(v, (list, tuple)) else [v]:
                    query.append(("expand[]", str(e)))
            elif isinstance(v, (list, tuple)):
                for e in v:
                    query.append((f"{k}[]", _q(e)))
            elif isinstance(v, dict):
                query.append((k, json.dumps(v)))
            else:
                query.append((k, _q(v)))
        url = self.base_url + path + ("?" + urllib.parse.urlencode(query) if query else "")

        headers: Dict[str, str] = {
            "Accept": "application/json" if op["response"] == "json" else "*/*",
            "Checkbox-Version": options.get("api_version") or self.api_version,
            "User-Agent": self._user_agent,
        }
        headers.update(self._headers)
        headers.update(options.get("headers") or {})
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        data: Optional[bytes] = None
        idempotency_key: Optional[str] = None
        if op["http_method"] == "POST":
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
            if op["idempotent"] or options.get("idempotency_key"):
                idempotency_key = options.get("idempotency_key") or f"sdk_{uuid.uuid4()}"
                headers["Idempotency-Key"] = idempotency_key

        max_retries = max(0, int(options.get("max_network_retries", self.max_network_retries)))
        timeout = float(options.get("timeout", self.timeout))
        attempt = 0
        while True:
            try:
                status, res_headers, raw = self._transport(op["http_method"], url, headers, data, timeout)
            except (urllib.error.URLError, OSError, socket.timeout) as e:
                if attempt < max_retries:
                    time.sleep(_backoff(attempt))
                    attempt += 1
                    continue
                timed_out = isinstance(e, socket.timeout) or "timed out" in str(e)
                raise APIConnectionError(
                    f"Request to {self.base_url} timed out after {timeout:g} s ({attempt + 1} attempts)."
                    if timed_out
                    else f"Could not reach {self.base_url}: {e} ({attempt + 1} attempts).",
                    type="connection_error",
                    code="timeout" if timed_out else "connection_failed",
                    next_action={"type": "retry", "message": "Check the network and CHECKBOX_API_BASE, then retry; POSTs are safe to retry with the same idempotency_key."},
                ) from e
            res_headers = {k.lower(): v for k, v in res_headers.items()}
            if status >= 400:
                text = raw.decode("utf-8", "replace")
                try:
                    parsed: Any = json.loads(text) if text else None
                except ValueError:
                    parsed = {"error": text[:300]} if text else None
                err = error_from_response(status, parsed, res_headers)
                if attempt < max_retries and _should_retry(status, err.code):
                    time.sleep(_retry_delay(attempt, res_headers.get("retry-after")))
                    attempt += 1
                    continue
                raise err
            meta = ResponseMeta(status, res_headers, idempotency_key)
            if op["response"] == "binary":
                disposition = res_headers.get("content-disposition", "")
                m = re.search(r'filename="?([^";]+)"?', disposition, re.I)
                f = CheckboxFile(raw, res_headers.get("content-type"), m.group(1) if m else None)
                f.last_response = meta
                return f
            text = raw.decode("utf-8")
            if op["response"] == "text":
                return text
            try:
                value = json.loads(text) if text else {}
            except ValueError:
                raise CheckboxError(f"Invalid JSON from the API (HTTP {status}).", type="api_error", code="invalid_response", status_code=status, request_id=meta.request_id) from None
            if not isinstance(value, dict):
                return value
            if op.get("list") and op.get("paginated"):
                page: ListObject[Any] = ListObject(value)
                page.last_response = meta
                page._params = dict(params)
                page._fetch_page = lambda p, _op=op, _a=path_args, _o=request_options: self._send_op(_op, _a, p, _o)
                return page
            obj = CheckboxObject(value)
            obj.last_response = meta
            return obj


def _q(v: Any) -> str:
    if v is True:
        return "true"
    if v is False:
        return "false"
    return str(v)


def _should_retry(status: int, code: Optional[str]) -> bool:
    return status == 429 or status >= 500 or (status == 409 and code == "idempotency_key_in_use")


def _backoff(attempt: int) -> float:
    """0.5 s, 1 s, 2 s, ... capped at 20 s, with jitter (75-100 %)."""
    base = min(0.5 * (2**attempt), MAX_RETRY_DELAY)
    return base * (0.75 + random.random() * 0.25)


def _retry_delay(attempt: int, retry_after: Optional[str]) -> float:
    try:
        s = float(retry_after) if retry_after is not None else 0.0
    except ValueError:
        s = 0.0
    return min(s, MAX_RETRY_DELAY) if s > 0 else _backoff(attempt)
