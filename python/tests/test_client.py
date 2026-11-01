"""Client behaviour against a local fake server: auth, versioning, idempotency, retries, errors, pagination, call()."""
import json
import re

import pytest

import checkbox
from checkbox import Checkbox
from checkbox.errors import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    CheckboxError,
    IdempotencyError,
    InvalidRequestError,
    PermissionError,
    RateLimitError,
)

from .conftest import error_body


def client(fake, key="ck_test_abc123", **kw):
    return Checkbox(key, base_url=fake.url, **kw)


def site(n):
    return {"id": f"site_{n}", "object": "site"}


def test_mode_detection_and_env(monkeypatch):
    assert Checkbox("ck_test_x").mode == "test"
    assert Checkbox("ck_test_x").livemode is False
    assert Checkbox("ck_live_x").mode == "live"
    assert Checkbox("rk_live_x").livemode is True
    assert Checkbox("sk_live_legacy").mode == "live"
    assert checkbox.mode_of_key("pk_test_1") == "test"
    assert checkbox.mode_of_key("nope") is None
    monkeypatch.setenv("CHECKBOX_API_KEY", "ck_live_env")
    monkeypatch.setenv("CHECKBOX_API_BASE", "https://env.example/")
    c = Checkbox()
    assert c.mode == "live" and c.base_url == "https://env.example"
    # `checkbox init` writes CHECKBOX_SECRET_KEY to .env.local: used when CHECKBOX_API_KEY is not set.
    monkeypatch.delenv("CHECKBOX_API_KEY")
    monkeypatch.setenv("CHECKBOX_SECRET_KEY", "ck_test_frominit")
    assert Checkbox().mode == "test"


def test_post_sends_key_version_user_agent_json_and_idempotency_key(fake):
    fake.script([{"body": {**site(1), "url": "https://acme.test/"}}])
    c = client(fake, app_info={"name": "my-app", "version": "1.0"})
    created = c.sites.create(url="https://acme.test", name="Acme")
    assert created["id"] == "site_1"
    assert isinstance(created, dict)
    req = fake.requests[0]
    assert (req.method, req.path) == ("POST", "/v1/sites")
    assert req.headers["authorization"] == "Bearer ck_test_abc123"
    assert req.headers["checkbox-version"] == checkbox.API_VERSION
    assert re.match(r"^checkbox-python/\d+\.\d+\.\d+ python/\S+ my-app/1\.0$", req.headers["user-agent"])
    assert re.match(r"^sdk_[0-9a-f-]{36}$", req.headers["idempotency-key"])
    assert req.body == {"url": "https://acme.test", "name": "Acme"}
    meta = created.last_response
    assert meta.status_code == 200 and meta.request_id == "req_1" and meta.idempotency_key == req.headers["idempotency-key"]
    assert json.loads(json.dumps(created)) == {**site(1), "url": "https://acme.test/"}


def test_params_dict_and_kwargs_merge_and_request_options(fake):
    fake.script([{"body": site(1)}])
    client(fake).sites.update(
        "site_1",
        {"name": "New"},
        monitoring_interval_minutes=60,
        request_options={"idempotency_key": "mine-1", "api_key": "ck_live_other", "api_version": "2026-10-30", "headers": {"X-Extra": "1"}},
    )
    req = fake.requests[0]
    assert req.path == "/v1/sites/site_1"
    assert req.body == {"name": "New", "monitoring_interval_minutes": 60}
    assert req.headers["idempotency-key"] == "mine-1"
    assert req.headers["authorization"] == "Bearer ck_live_other"
    assert req.headers["x-extra"] == "1"


def test_get_params_and_expand_go_to_the_query_and_path_params_are_encoded(fake):
    fake.script([{"body": site(1)}, {"body": {"object": "list", "data": [], "has_more": False, "url": "/v1/findings"}}])
    c = client(fake)
    c.sites.retrieve("site/1?x", expand=["latest_scan", "domain_verification"])
    req = fake.requests[0]
    assert req.path == "/v1/sites/site%2F1%3Fx"
    assert req.query == [("expand[]", "latest_scan"), ("expand[]", "domain_verification")]
    assert req.body is None and "idempotency-key" not in req.headers
    c.findings.list(site="site_1", status="fail", limit=5)
    assert fake.requests[1].query_dict == {"site": "site_1", "status": "fail", "limit": "5"}


def test_post_params_are_split_between_query_and_body(fake):
    fake.script([{"body": {"id": "ver_1"}}])
    client(fake).tasks.verify("task_1", wait=30, html="<button>Subscribe</button>")
    req = fake.requests[0]
    assert req.query_dict == {"wait": "30"}
    assert req.body == {"html": "<button>Subscribe</button>"}


def test_local_errors_missing_path_param_and_missing_key(fake):
    fake.script([])
    with pytest.raises(InvalidRequestError) as e:
        client(fake).sites.retrieve("")
    assert e.value.code == "parameter_missing" and e.value.param == "site"
    with pytest.raises(AuthenticationError) as e2:
        Checkbox(base_url=fake.url).account.retrieve()
    assert e2.value.code == "api_key_missing"
    assert "/v1/device/authorize" in e2.value.next_action["message"]
    assert "npx checkbox" not in e2.value.next_action["message"]
    assert fake.requests == []


def test_device_login_works_without_a_key(fake):
    fake.script([{"body": {"object": "device_authorization", "device_code": "cbdev_1"}}])
    res = Checkbox(base_url=fake.url).device.authorize(client={"name": "claude-code"})
    assert res["device_code"] == "cbdev_1"
    assert "authorization" not in fake.requests[0].headers
    assert "idempotency-key" not in fake.requests[0].headers


@pytest.mark.parametrize(
    "status,body,cls",
    [
        (400, error_body("invalid_request_error", "parameter_invalid", param="url"), InvalidRequestError),
        (404, error_body("invalid_request_error", "resource_missing"), InvalidRequestError),
        (401, error_body("authentication_error", "api_key_invalid"), AuthenticationError),
        (403, error_body("permission_error", "account_not_activated", next_action={"type": "verify_domain", "message": "Verify.", "operation_id": "createDomainVerification"}), PermissionError),
        (400, error_body("idempotency_error", "idempotency_key_reused"), IdempotencyError),
        (418, {"nonsense": True}, InvalidRequestError),
    ],
)
def test_error_envelopes_map_to_typed_errors(fake, status, body, cls):
    fake.script([{"status": status, "body": body}])
    with pytest.raises(cls) as e:
        client(fake, max_network_retries=0).sites.list()
    err = e.value
    assert isinstance(err, CheckboxError)
    assert err.status_code == status
    if "error" in body:
        assert err.code == body["error"]["code"]
        assert err.request_id == "req_err"
        assert err.doc_url.endswith(body["error"]["code"])
        assert err.to_dict()["code"] == body["error"]["code"]
    if status == 403:
        assert err.next_action["operation_id"] == "createDomainVerification"
        assert "account_not_activated" in str(err)


def test_retries_429_5xx_in_use_and_network_errors_with_one_idempotency_key(fake):
    fake.script(
        [
            {"status": 429, "headers": {"retry-after": "0.01"}, "body": error_body("rate_limit_error", "rate_limit_exceeded")},
            {"drop": True},
            {"status": 409, "body": error_body("idempotency_error", "idempotency_key_in_use")},
            {"status": 503, "body": error_body("api_error", "internal_error")},
            {"body": site(9), "headers": {"idempotent-replayed": "true"}},
        ]
    )
    res = client(fake, max_network_retries=4).sites.create(url="https://acme.test")
    assert res["id"] == "site_9"
    assert len(fake.requests) == 5
    assert len({r.headers["idempotency-key"] for r in fake.requests}) == 1
    assert res.last_response.idempotent_replayed is True


def test_no_retry_on_4xx_and_gives_up_after_max_retries(fake):
    fake.script([{"status": 400, "body": error_body("invalid_request_error", "parameter_invalid")}])
    with pytest.raises(InvalidRequestError):
        client(fake).sites.create(url="x")
    assert len(fake.requests) == 1
    fake.script(lambda req, i: {"status": 500, "body": error_body("api_error", "internal_error")})
    with pytest.raises(APIError):
        client(fake, max_network_retries=1).account.retrieve()
    assert len(fake.requests) == 2
    fake.script(lambda req, i: {"status": 429, "headers": {"retry-after": "0.01"}, "body": error_body("rate_limit_error", "rate_limit_exceeded")})
    with pytest.raises(RateLimitError):
        client(fake, max_network_retries=0).account.retrieve()


def test_connection_errors_after_retries():
    c = Checkbox("ck_test_x", base_url="http://127.0.0.1:9", max_network_retries=1, timeout=2)
    with pytest.raises(APIConnectionError) as e:
        c.account.retrieve()
    assert e.value.code in ("connection_failed", "timeout")
    assert "2 attempts" in e.value.message
    assert e.value.next_action["type"] == "retry"


def test_auto_pagination_forward(fake):
    pages = {
        None: {"object": "list", "data": [site(1), site(2)], "has_more": True, "url": "/v1/sites"},
        "site_2": {"object": "list", "data": [site(3), site(4)], "has_more": True, "url": "/v1/sites"},
        "site_4": {"object": "list", "data": [site(5)], "has_more": False, "url": "/v1/sites"},
    }
    fake.script(lambda req, i: {"body": pages[req.query_dict.get("starting_after")]})
    c = client(fake)
    page = c.sites.list(limit=2)
    assert [s["id"] for s in page.data] == ["site_1", "site_2"] and page.has_more
    assert page["object"] == "list"
    assert [s["id"] for s in page.auto_paging_iter()] == [f"site_{n}" for n in range(1, 6)]
    assert [r.query_dict.get("starting_after") for r in fake.requests[1:]] == ["site_2", "site_4"]
    assert all(r.query_dict["limit"] == "2" for r in fake.requests)


def test_auto_pagination_backward(fake):
    def respond(req, i):
        if req.query_dict.get("ending_before") == "site_5":
            return {"body": {"object": "list", "data": [site(3), site(4)], "has_more": True, "url": ""}}
        return {"body": {"object": "list", "data": [site(2)], "has_more": False, "url": ""}}

    fake.script(respond)
    ids = [s["id"] for s in client(fake).sites.list(ending_before="site_5", limit=2).auto_paging_iter()]
    assert ids == ["site_4", "site_3", "site_2"]
    assert fake.requests[1].query_dict["ending_before"] == "site_3"


def test_call_with_flat_args(fake):
    fake.script(lambda req, i: {"body": {"object": "list", "data": [], "has_more": False, "url": ""}} if req.method == "GET" else {"body": {"id": "ver_1"}})
    c = client(fake)
    c.call("verifyTask", {"task": "task_9", "wait": 10, "html": "<p/>"})
    req = fake.requests[0]
    assert (req.method, req.path, req.query_dict, req.body) == ("POST", "/v1/tasks/task_9/verify", {"wait": "10"}, {"html": "<p/>"})
    c.call("listTestRuns", site="site_1", limit=3)
    assert fake.requests[1].path == "/v1/sites/site_1/test_runs"
    with pytest.raises(InvalidRequestError):
        c.call("nope")


def test_binary_download_and_text_bundle(fake):
    png = b"\x89PNG\r\n"
    fake.script(
        [
            {"raw": png, "headers": {"content-type": "image/png", "content-disposition": 'attachment; filename="ev_1.png"'}},
            {"raw": "customElements.define('checkbox-disclosure', X);", "headers": {"content-type": "application/javascript"}},
        ]
    )
    c = client(fake)
    f = c.evidence.download_content("ev_1")
    assert (f.data, f.content_type, f.filename) == (png, "image/png", "ev_1.png")
    assert "checkbox-disclosure" in c.elements.retrieve_bundle()


def test_raw_request_and_delete(fake):
    fake.script(lambda req, i: {"body": {"ok": True, "deleted": True}})
    c = client(fake)
    assert c.request("POST", "/v1/new_thing", {"a": 1})["ok"] is True
    assert fake.requests[0].body == {"a": 1} and fake.requests[0].headers["idempotency-key"].startswith("sdk_")
    c.request("GET", "/v1/sites", {"limit": 3})
    assert fake.requests[1].query_dict == {"limit": "3"}
    c.webhook_endpoints.delete("we_1")
    assert (fake.requests[2].method, fake.requests[2].path) == ("DELETE", "/v1/webhook_endpoints/we_1")


def test_every_operation_has_a_method():
    c = Checkbox("ck_test_x")
    for op_id, op in checkbox.OPERATIONS.items():
        ns = getattr(c, op["namespace"])
        assert callable(getattr(ns, op["method"])), op_id
    assert callable(c.checks.stripe_checkout_session)
    assert callable(c.findings.list)
