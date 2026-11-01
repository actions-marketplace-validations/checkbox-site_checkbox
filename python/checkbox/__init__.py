"""Checkbox Python SDK: automatic-renewal-law compliance for subscription businesses.

    from checkbox import Checkbox

    checkbox = Checkbox()  # reads CHECKBOX_API_KEY, then CHECKBOX_SECRET_KEY (written by `checkbox init`)
    result = checkbox.checks.stripe_checkout_session(params=session_params)
    print(result["verdict"], result["next_action"])

Stdlib only. Responses are plain dicts (see ``checkbox.types`` for their shape).
"""
from . import types, webhook
from ._client import DEFAULT_BASE_URL, DEFAULT_MAX_NETWORK_RETRIES, DEFAULT_TIMEOUT, Checkbox, mode_of_key
from ._resource import CheckboxFile, CheckboxObject, ListObject, RequestOptions, ResponseMeta
from ._resources import OPERATIONS
from ._version import VERSION
from .errors import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    CheckboxError,
    IdempotencyError,
    InvalidRequestError,
    PermissionError,
    RateLimitError,
    SignatureVerificationError,
)
from .types import API_VERSION, ERROR_CODES, WEBHOOK_EVENT_TYPES
from .webhook import Webhook, construct_event

__version__ = VERSION

__all__ = [
    "Checkbox",
    "mode_of_key",
    "types",
    "webhook",
    "Webhook",
    "construct_event",
    "OPERATIONS",
    "API_VERSION",
    "ERROR_CODES",
    "WEBHOOK_EVENT_TYPES",
    "VERSION",
    "DEFAULT_BASE_URL",
    "DEFAULT_MAX_NETWORK_RETRIES",
    "DEFAULT_TIMEOUT",
    "CheckboxFile",
    "CheckboxObject",
    "ListObject",
    "RequestOptions",
    "ResponseMeta",
    "CheckboxError",
    "InvalidRequestError",
    "AuthenticationError",
    "PermissionError",
    "RateLimitError",
    "IdempotencyError",
    "APIError",
    "APIConnectionError",
    "SignatureVerificationError",
]
