"""Base class of the generated resource namespaces, request options, list pages and downloaded files."""
from typing import TYPE_CHECKING, Any, Callable, Dict, Generic, Iterator, Mapping, Optional, Tuple, TypeVar

try:  # Python 3.8+: TypedDict lives in typing
    from typing import TypedDict
except ImportError:  # pragma: no cover
    TypedDict = dict  # type: ignore[misc,assignment]

if TYPE_CHECKING:
    from ._client import Checkbox

T = TypeVar("T")


class RequestOptions(TypedDict, total=False):
    """Per-request options (``request_options=`` on every method)."""

    #: Idempotency-Key for this POST; generated automatically (and reused across retries) when omitted.
    idempotency_key: str
    #: Checkbox-Version for this request (defaults to the client's).
    api_version: str
    #: Another API key for this request.
    api_key: str
    #: Per-attempt timeout in seconds.
    timeout: float
    #: Retries on network errors, 409 idempotency_key_in_use, 429 and 5xx.
    max_network_retries: int
    #: Extra request headers.
    headers: Dict[str, str]


class ResponseMeta:
    """Response metadata (status, request id, idempotency replay, headers) of the last response."""

    def __init__(self, status_code: int, headers: Mapping[str, str], idempotency_key: Optional[str]) -> None:
        self.status_code = status_code
        self.headers: Dict[str, str] = dict(headers)
        self.request_id = self.headers.get("request-id")
        self.api_version = self.headers.get("checkbox-version")
        self.idempotency_key = idempotency_key
        self.idempotent_replayed = self.headers.get("idempotent-replayed") == "true"

    def __repr__(self) -> str:
        return f"ResponseMeta(status_code={self.status_code}, request_id={self.request_id!r}, idempotent_replayed={self.idempotent_replayed})"


class CheckboxObject(dict):  # type: ignore[type-arg]
    """A response object: a plain ``dict`` with ``last_response`` metadata attached."""

    last_response: Optional[ResponseMeta] = None


class ListObject(CheckboxObject, Generic[T]):
    """A page of a list (``{"object": "list", "data": [...], "has_more": bool, "url": str}``).

    ``for item in page.auto_paging_iter()`` walks every object across pages.
    """

    _fetch_page: Optional[Callable[[Dict[str, Any]], "ListObject[T]"]] = None
    _params: Dict[str, Any] = {}

    @property
    def data(self) -> "list[T]":  # noqa: UP037
        return self.get("data") or []

    @property
    def has_more(self) -> bool:
        return bool(self.get("has_more"))

    def auto_paging_iter(self) -> Iterator[T]:
        """Yields every object of this page and the following ones (``starting_after`` cursor pagination;
        ``ending_before`` pagination when the first request used it)."""
        page: "ListObject[T]" = self
        backwards = "ending_before" in self._params and "starting_after" not in self._params
        while True:
            items = list(reversed(page.data)) if backwards else page.data
            for item in items:
                yield item
            if not page.has_more or not page.data or page._fetch_page is None:
                return
            cursor = page.data[0] if backwards else page.data[-1]
            cursor_id = cursor.get("id") if isinstance(cursor, dict) else None
            if not isinstance(cursor_id, str):
                return
            params = {k: v for k, v in self._params.items() if k not in ("starting_after", "ending_before")}
            params["ending_before" if backwards else "starting_after"] = cursor_id
            page = page._fetch_page(params)


class CheckboxFile:
    """A downloaded file (evidence content)."""

    def __init__(self, data: bytes, content_type: Optional[str], filename: Optional[str]) -> None:
        self.data = data
        self.content_type = content_type
        self.filename = filename
        self.last_response: Optional[ResponseMeta] = None

    def __repr__(self) -> str:
        return f"CheckboxFile(filename={self.filename!r}, content_type={self.content_type!r}, size={len(self.data)})"


class Resource:
    """Base of every ``checkbox.<namespace>`` object."""

    def __init__(self, client: "Checkbox") -> None:
        self._client = client

    def _call(
        self,
        operation_id: str,
        path_args: Tuple[str, ...],
        params: Optional[Mapping[str, Any]],
        kwargs: Optional[Mapping[str, Any]],
        request_options: Optional[RequestOptions],
    ) -> Any:
        merged: Dict[str, Any] = dict(params or {})
        merged.update(kwargs or {})
        return self._client._send(operation_id, path_args, merged, request_options)
