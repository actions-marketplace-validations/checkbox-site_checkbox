"""Preflight Stripe Checkout Session params with Checkbox before creating the session.

Checkbox checks the params against automatic-renewal laws (ROSCA, California, New York, ...) and returns a corrected copy
(consent collection, renewal terms next to the button, cancellation instructions). Used by flask_app.py.
"""
from typing import Any, Dict, Optional, Tuple

from checkbox import APIConnectionError, APIError, Checkbox, RateLimitError


def compliant_checkout_params(cb: Checkbox, params: Dict[str, Any], merchant: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any], bool]:
    """Returns ``(params, check, corrected)``: the original params when they pass, else Checkbox's corrected params.

    Raises ValueError when even the corrected params fail (a human has to decide; see ``check["next_action"]``).
    Keep ``check["id"]`` in your logs: it records what you checked.
    """
    check = cb.checks.stripe_checkout_session(params=params, merchant=merchant)
    if check["verdict"] != "fail":
        return params, check, False
    corrected = check["correction"]["corrected_params"]
    recheck = cb.checks.stripe_checkout_session(params=corrected, merchant=merchant)
    if recheck["verdict"] == "fail":
        raise ValueError(f"Checkout params still fail automatic-renewal checks: {recheck['next_action']['message']}")
    return corrected, recheck, True


def compliant_checkout_params_or_original(
    cb: Checkbox, params: Dict[str, Any], merchant: Dict[str, Any]
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], bool]:
    """Like compliant_checkout_params, but never blocks a sale when Checkbox is unreachable (log and continue)."""
    try:
        return compliant_checkout_params(cb, params, merchant)
    except (APIConnectionError, APIError, RateLimitError) as err:
        print(f"Checkbox preflight unavailable ({err.code}, {err.request_id}); using the original params")
        return params, None, False
