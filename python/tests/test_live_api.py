"""The Python SDK against the REAL Checkbox API (apps/api started by apps/api/src/testing/serve-sdk-api.ts on a local
port with Postgres). The API validates every response against its documented schema. Skipped when Node/pnpm or
Postgres is unavailable. Database: SDK_PY_TEST_DATABASE_URL (default subcomply_test_sdks_py; it is RESET)."""
import pytest

import checkbox
from checkbox import Checkbox
from checkbox.errors import AuthenticationError, IdempotencyError, InvalidRequestError, PermissionError

PLAN = {"merchant_name": "Joybox", "price": 19.99, "interval": "month", "cancel_url": "https://joybox.example/account/cancel"}


def test_account_in_test_mode(cb):
    account = cb.account.retrieve()
    assert account["object"] == "account" and account["livemode"] is False
    assert account.last_response.request_id.startswith("req_")
    assert account.last_response.api_version == checkbox.API_VERSION


def test_sites_crud_idempotency_and_pagination(cb):
    first = cb.sites.create(url="https://one.acme.test/", name="One", request_options={"idempotency_key": "py-site-one"})
    replay = cb.sites.create(url="https://one.acme.test/", name="One", request_options={"idempotency_key": "py-site-one"})
    assert replay["id"] == first["id"] and replay.last_response.idempotent_replayed
    with pytest.raises(IdempotencyError) as e:
        cb.sites.create(url="https://other.acme.test", request_options={"idempotency_key": "py-site-one"})
    assert e.value.code == "idempotency_key_reused"
    two = cb.sites.create(url="https://two.acme.test")
    three = cb.sites.create(url="https://three.acme.test")
    assert cb.sites.retrieve(first["id"], expand=["domain_verification"])["id"] == first["id"]
    assert cb.sites.update(first["id"], name="One renamed")["name"] == "One renamed"
    page = cb.sites.list(limit=2)
    assert len(page.data) == 2 and page.has_more
    ids = [s["id"] for s in cb.sites.list(limit=2).auto_paging_iter()]
    assert len(ids) == len(set(ids)) >= 3  # the session's API is shared with other tests
    assert {first["id"], two["id"], three["id"]} <= set(ids)
    assert cb.sites.delete(first["id"])["archived"] is True
    assert first["id"] in [s["id"] for s in cb.sites.list(archived="true").auto_paging_iter()]
    assert cb.sites.restore(first["id"])["archived"] is False


def test_preflight_stripe_checkout_session_loop(cb):
    params = {"mode": "subscription", "line_items": [{"price": "price_123", "quantity": 1}], "success_url": "https://joybox.example/ok"}
    result = cb.checks.stripe_checkout_session(params=params, merchant=PLAN, as_of="2026-10-30")
    assert result["object"] == "check_result" and result["verdict"] != "pass"
    assert result["next_action"]
    assert result["correction"]["patch"]
    again = cb.checks.stripe_checkout_session(params=result["correction"]["corrected_params"], merchant=PLAN, as_of="2026-10-30")
    assert again["correction"]["patch"] == []
    disclosure = cb.checks.disclosure({**PLAN, "text": "Start today!", "jurisdictions": ["CA"], "as_of": "2026-10-30"})
    assert disclosure["verdict"] == "fail" and disclosure["replacement"]["verified"] is True


def test_typed_errors_from_the_real_api(api, cb):
    with pytest.raises(InvalidRequestError) as missing:
        cb.sites.retrieve("site_00000000000000000000000000000000")
    assert missing.value.status_code == 404 and missing.value.code == "resource_missing"
    with pytest.raises(InvalidRequestError) as invalid:
        cb.checks.disclosure({**PLAN, "text": "x", "interval": "fortnight"})
    assert invalid.value.code == "parameter_invalid" and invalid.value.param == "interval"
    with pytest.raises(AuthenticationError) as auth:
        Checkbox("ck_test_" + "x" * 43, base_url=api.url).account.retrieve()
    assert auth.value.code == "api_key_invalid"
    live = Checkbox(api.live_key, base_url=api.url, max_network_retries=0)
    assert live.mode == "live"
    with pytest.raises(PermissionError) as perm:
        live.checks.page(url="https://joybox.example/checkout")
    assert perm.value.code == "account_not_activated" and perm.value.next_action


def test_call_flat_args_and_findings(cb):
    site = cb.call("createSite", {"url": "https://call.acme.test"})
    assert cb.call("retrieveSite", site=site["id"])["url"] == "https://call.acme.test/"
    assert cb.call("createEvaluation", {"site": site["id"]})["object"] == "evaluation"
    findings = list(cb.findings.list(site=site["id"], limit=100).auto_paging_iter())
    assert isinstance(findings, list)


def test_signed_webhooks_verify(api, cb):
    endpoint = cb.webhook_endpoints.create(url="http://localhost:9/hooks/py", enabled_events=["site.score_changed", "scan.completed"])
    assert endpoint["secret"].startswith("whsec_")
    api.sweep()
    site = cb.sites.create(url="https://hooks.acme.test")
    cb.evaluations.create(site["id"])
    deliveries = [d for d in api.sweep() if d["url"] == "http://localhost:9/hooks/py"]
    assert deliveries
    events = [checkbox.Webhook.construct_event(d["body"], d["headers"]["checkbox-signature"], endpoint["secret"]) for d in deliveries]
    score = next(e for e in events if e["type"] == "site.score_changed" and e["data"]["object"]["id"] == site["id"])
    with pytest.raises(checkbox.SignatureVerificationError):
        checkbox.construct_event(deliveries[0]["body"], deliveries[0]["headers"]["checkbox-signature"], "whsec_wrong")
    listed = [e["id"] for e in cb.events.list(type="site.*", limit=100).auto_paging_iter()]
    assert score["id"] in listed
    cb.webhook_endpoints.delete(endpoint["id"])
