import json
import time

import pytest

import checkbox
from checkbox import SignatureVerificationError, Webhook
from checkbox.webhook import compute_signature, construct_event, generate_test_header

SECRET = "whsec_test_5f0c1d2e3a4b"
EVENT = {
    "id": "evt_1",
    "object": "event",
    "type": "finding.created",
    "api_version": "2026-10-30",
    "created": 1790000000,
    "livemode": False,
    "data": {"object": {"id": "fnd_1", "object": "finding", "status": "fail"}},
    "pending_webhooks": 1,
    "request": {"id": None, "idempotency_key": None},
}
PAYLOAD = json.dumps(EVENT)


def test_construct_event_accepts_valid_signatures():
    header = generate_test_header(PAYLOAD, SECRET)
    assert construct_event(PAYLOAD, header, SECRET)["id"] == "evt_1"
    assert Webhook.construct_event(PAYLOAD.encode(), header, SECRET)["type"] == "finding.created"
    assert checkbox.Checkbox.webhooks.construct_event(PAYLOAD, header, SECRET)["id"] == "evt_1"


def test_matches_the_server_scheme():
    # HMAC-SHA256 of "<t>.<raw body>" with the secret, hex encoded (same as apps/api/src/v1/webhooks/signature.ts).
    import hashlib
    import hmac

    t = 1790000000
    expected = hmac.new(SECRET.encode(), f"{t}.{PAYLOAD}".encode(), hashlib.sha256).hexdigest()
    assert compute_signature(PAYLOAD, SECRET, t) == expected


def test_any_v1_entry_matches_secret_roll():
    now = int(time.time())
    good = generate_test_header(PAYLOAD, SECRET, now).split("v1=")[1]
    header = f"t={now},v1={'0' * 64},v1={good}"
    assert construct_event(PAYLOAD, header, SECRET)["id"] == "evt_1"


@pytest.mark.parametrize(
    "payload,header,secret,match",
    [
        (PAYLOAD, None, "whsec_other", "No signature matches"),
        (PAYLOAD.replace("fail", "pass"), None, SECRET, "raw request body"),
        (PAYLOAD, "nope", SECRET, "malformed"),
        (PAYLOAD, "", SECRET, "Missing"),
        (PAYLOAD, None, "", "No webhook secret"),
    ],
)
def test_rejections(payload, header, secret, match):
    h = generate_test_header(PAYLOAD, SECRET) if header is None else header
    with pytest.raises(SignatureVerificationError, match=match):
        construct_event(payload, h, secret)


def test_tolerance_and_parsed_json_misuse():
    old = generate_test_header(PAYLOAD, SECRET, int(time.time()) - 600)
    with pytest.raises(SignatureVerificationError, match="tolerance"):
        construct_event(PAYLOAD, old, SECRET)
    assert construct_event(PAYLOAD, old, SECRET, tolerance=900)["id"] == "evt_1"
    with pytest.raises(SignatureVerificationError, match="raw request body"):
        construct_event(EVENT, generate_test_header(PAYLOAD, SECRET), SECRET)  # type: ignore[arg-type]
