"""Webhook signature verification.

Checkbox signs every delivery with ``Checkbox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>``
(several ``v1`` entries during a secret roll). Verify against the RAW request body: re-serialised JSON will not match.
"""
import hashlib
import hmac
import json
import time
from typing import Any, List, Optional, Tuple, Union

from .errors import SignatureVerificationError

SIGNATURE_HEADER = "Checkbox-Signature"
#: Default maximum age of a signature in seconds (replay protection).
DEFAULT_TOLERANCE = 300


def _text(payload: Union[str, bytes, bytearray]) -> str:
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload).decode("utf-8")
    if isinstance(payload, str):
        return payload
    raise SignatureVerificationError(
        "Webhook payload must be the raw request body (str or bytes), not parsed JSON. "
        "In Flask use request.get_data(); in Django request.body; in FastAPI await request.body().",
        None,
        str(payload),
    )


def parse_signature_header(header: Optional[str]) -> Optional[Tuple[int, List[str]]]:
    """Returns ``(timestamp, [v1 signatures])`` or None when malformed."""
    if not header or len(header) > 2000:
        return None
    timestamp: Optional[int] = None
    signatures: List[str] = []
    for part in header.split(","):
        key, sep, value = part.strip().partition("=")
        if not sep:
            continue
        value = value.strip()
        if key == "t" and value.isdigit() and len(value) <= 12:
            timestamp = int(value)
        elif key == "v1" and len(value) == 64 and all(c in "0123456789abcdefABCDEF" for c in value):
            signatures.append(value.lower())
    if timestamp is None or not signatures:
        return None
    return timestamp, signatures


def compute_signature(payload: str, secret: str, timestamp: int) -> str:
    return hmac.new(secret.encode("utf-8"), f"{timestamp}.{payload}".encode("utf-8"), hashlib.sha256).hexdigest()


def verify_header(payload: Union[str, bytes], header: Optional[str], secret: str, tolerance: int = DEFAULT_TOLERANCE, now: Optional[int] = None) -> bool:
    """Raises SignatureVerificationError unless the header is a valid, fresh signature of payload; returns True."""
    text = _text(payload)
    if not secret:
        raise SignatureVerificationError("No webhook secret given. Use the endpoint secret (whsec_…) from create_webhook_endpoint.", header, text)
    parsed = parse_signature_header(header)
    if parsed is None:
        raise SignatureVerificationError(
            f'Missing or malformed {SIGNATURE_HEADER} header (expected "t=<timestamp>,v1=<signature>").', header, text
        )
    timestamp, signatures = parsed
    expected = compute_signature(text, secret, timestamp)
    if not any(hmac.compare_digest(expected, s) for s in signatures):
        raise SignatureVerificationError(
            "No signature matches the payload. Check that you pass the raw request body (not parsed JSON) "
            "and the secret of this endpoint.",
            header,
            text,
        )
    current = int(time.time()) if now is None else now
    if tolerance > 0 and abs(current - timestamp) > tolerance:
        raise SignatureVerificationError(
            f"Signature timestamp is outside the tolerance of {tolerance} seconds (possible replay).", header, text
        )
    return True


def construct_event(
    payload: Union[str, bytes], sig_header: Optional[str], secret: str, tolerance: int = DEFAULT_TOLERANCE, now: Optional[int] = None
) -> Any:
    """Verifies ``Checkbox-Signature`` and returns the parsed event (a dict; see ``types.WebhookEvent``)."""
    verify_header(payload, sig_header, secret, tolerance, now)
    text = _text(payload)
    try:
        return json.loads(text)
    except ValueError:
        raise SignatureVerificationError("The payload is not valid JSON.", sig_header, text) from None


def generate_test_header(payload: str, secret: str, timestamp: Optional[int] = None) -> str:
    """Builds a valid Checkbox-Signature header for a payload (for your tests)."""
    t = int(time.time()) if timestamp is None else timestamp
    return f"t={t},v1={compute_signature(payload, secret, t)}"


class Webhook:
    """Stripe-style alias: ``checkbox.Webhook.construct_event(payload, sig_header, secret)``."""

    construct_event = staticmethod(construct_event)
    verify_header = staticmethod(verify_header)
    generate_test_header = staticmethod(generate_test_header)
