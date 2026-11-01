"""Typed errors. Branch on ``code`` (stable), not on the message; ``next_action`` tells an agent what to do next."""
from typing import Any, Dict, Mapping, Optional


class CheckboxError(Exception):
    """Base class of every error the SDK raises."""

    def __init__(
        self,
        message: str,
        *,
        type: str = "api_error",
        code: Optional[str] = None,
        param: Optional[str] = None,
        status_code: Optional[int] = None,
        request_id: Optional[str] = None,
        doc_url: Optional[str] = None,
        next_action: Optional[Dict[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        raw: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        #: Error category (``invalid_request_error``, ``authentication_error``, ...).
        self.type = type
        #: Stable machine-readable code (``resource_missing``, ``parameter_invalid``, ...); see ``types.ERROR_CODES``.
        self.code = code
        #: The parameter the error is about, when there is one.
        self.param = param
        #: HTTP status (None for connection and signature errors).
        self.status_code = status_code
        #: ``req_…`` id; quote it to support.
        self.request_id = request_id
        self.doc_url = doc_url
        #: What an agent should do next: ``{"type", "message", "operation_id"?, "url"?}``.
        self.next_action = next_action
        self.headers: Dict[str, str] = dict(headers or {})
        #: The ``error`` object of the response body.
        self.raw = raw

    def __str__(self) -> str:
        parts = [self.message]
        if self.code:
            parts.append(f"(code: {self.code})")
        if self.request_id:
            parts.append(f"[{self.request_id}]")
        return " ".join(parts)

    def __repr__(self) -> str:
        return f"{type(self).__name__}(message={self.message!r}, code={self.code!r}, status_code={self.status_code!r}, request_id={self.request_id!r})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "code": self.code,
            "message": self.message,
            "param": self.param,
            "status": self.status_code,
            "request_id": self.request_id,
            "doc_url": self.doc_url,
            "next_action": self.next_action,
        }


class InvalidRequestError(CheckboxError):
    """Bad parameters, unknown object (``resource_missing``), wrong state (``resource_conflict``), ... (HTTP 400/404/409/410)."""


class AuthenticationError(CheckboxError):
    """Missing, unknown or revoked API key (HTTP 401)."""


class PermissionError(CheckboxError):  # noqa: A001 - mirrors the API's permission_error
    """The key may not do this: publishable key, missing scope or role, live mode not activated (HTTP 403)."""


class RateLimitError(CheckboxError):
    """Too many requests (HTTP 429); retried automatically, raised when retries are exhausted."""


class IdempotencyError(CheckboxError):
    """An Idempotency-Key was reused with a different body, or is still in use."""


class APIError(CheckboxError):
    """Something went wrong on Checkbox's side (HTTP 5xx); retrying with the same idempotency key is safe."""


class APIConnectionError(CheckboxError):
    """The API could not be reached (DNS, TLS, timeout, connection reset) after the retries."""


class SignatureVerificationError(CheckboxError):
    """A webhook's Checkbox-Signature did not match the payload and secret, or was too old."""

    def __init__(self, message: str, sig_header: Optional[str] = None, payload: Optional[str] = None) -> None:
        super().__init__(message, type="signature_verification_error", code="signature_verification_failed")
        self.sig_header = sig_header
        self.payload = payload


_BY_TYPE = {
    "invalid_request_error": InvalidRequestError,
    "authentication_error": AuthenticationError,
    "permission_error": PermissionError,
    "rate_limit_error": RateLimitError,
    "idempotency_error": IdempotencyError,
    "api_error": APIError,
}


def _type_for_status(status: int) -> str:
    if status == 401:
        return "authentication_error"
    if status == 403:
        return "permission_error"
    if status == 429:
        return "rate_limit_error"
    if 400 <= status < 500:
        return "invalid_request_error"
    return "api_error"


def error_from_response(status: int, body: Any, headers: Mapping[str, str]) -> CheckboxError:
    """Builds the right error subclass from an HTTP status and the parsed response body."""
    err = body.get("error") if isinstance(body, dict) else None
    raw = err if isinstance(err, dict) else None
    if raw is not None and isinstance(raw.get("message"), str):
        message = raw["message"]
    elif isinstance(err, str):
        message = err
    else:
        message = f"Checkbox API returned HTTP {status}."
    etype = (raw or {}).get("type") or _type_for_status(status)
    cls = _BY_TYPE.get(etype, APIError)
    next_action = (raw or {}).get("next_action")
    return cls(
        message,
        type=etype,
        code=(raw or {}).get("code"),
        param=(raw or {}).get("param"),
        status_code=status,
        request_id=(raw or {}).get("request_id") or headers.get("request-id"),
        doc_url=(raw or {}).get("doc_url"),
        next_action=next_action if isinstance(next_action, dict) else None,
        headers=headers,
        raw=raw,
    )


__all__ = [
    "CheckboxError",
    "InvalidRequestError",
    "AuthenticationError",
    "PermissionError",
    "RateLimitError",
    "IdempotencyError",
    "APIError",
    "APIConnectionError",
    "SignatureVerificationError",
    "error_from_response",
]
