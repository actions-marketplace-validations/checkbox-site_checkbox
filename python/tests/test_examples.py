"""The examples in sdks/python/examples run against the real API (Flask and Stripe are not needed for these parts)."""
import os
import sys

import pytest

from checkbox import Checkbox, Webhook

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "examples")))

PLAN = {"merchant_name": "Joybox", "price": 19.99, "interval": "month", "cancel_url": "https://joybox.example/account/cancel"}
PARAMS = {"mode": "subscription", "line_items": [{"price": "price_123", "quantity": 1}], "success_url": "https://joybox.example/ok"}


def test_compliant_checkout_params(api, cb):
    from compliant_checkout import compliant_checkout_params, compliant_checkout_params_or_original

    params, check, corrected = compliant_checkout_params(cb, PARAMS, PLAN)
    assert corrected is True and check["verdict"] != "fail"
    assert params["consent_collection"] == {"terms_of_service": "required"}
    unreachable = Checkbox(api.test_key, base_url="http://127.0.0.1:9", max_network_retries=0)
    assert compliant_checkout_params_or_original(unreachable, PARAMS, PLAN) == (PARAMS, None, False)


def test_register_site(cb):
    from register_site import register_site

    out = register_site(cb, "https://register-py.acme.test", "https://register-py.acme.test/webhooks/checkbox")
    assert "<script" in out["site"]["install"]["script_tag"]
    assert out["endpoint"]["secret"].startswith("whsec_")
    assert out["plan"]["site"] == out["site"]["id"] and out["plan"]["next_action"]["description"]
    assert register_site(cb, "https://register-py.acme.test")["site"]["id"] == out["site"]["id"]


def test_flask_webhook_receiver_without_flask(monkeypatch):
    monkeypatch.setenv("CHECKBOX_API_KEY", "ck_test_example")
    from flask_app import receive_webhook

    payload = '{"id":"evt_1","object":"event","type":"site.compliant","data":{"object":{"id":"plan_1"}}}'
    header = Webhook.generate_test_header(payload, "whsec_example")
    assert receive_webhook(payload.encode(), header, "whsec_example") == (200, {"received": True, "handled": "Site is compliant"})
    status, body = receive_webhook(payload.encode(), header, "whsec_wrong")
    assert status == 400 and "No signature matches" in body["error"]


def test_flask_app_module_compiles():
    import py_compile

    here = os.path.join(os.path.dirname(__file__), "..", "examples")
    for name in os.listdir(here):
        if name.endswith(".py"):
            py_compile.compile(os.path.join(here, name), doraise=True)
    pytest.importorskip("flask")  # the full app needs Flask + stripe; only checked when installed


def _readme_block(heading: str) -> str:
    import re

    readme = open(os.path.join(os.path.dirname(__file__), "..", "README.md"), encoding="utf-8").read()
    section = readme.split(f"## {heading}\n", 1)[1]
    return re.search(r"```python\n(.*?)```", section, re.S).group(1)


def test_readme_quickstart_and_usage_run_against_the_api(api, monkeypatch, capsys):
    monkeypatch.setenv("CHECKBOX_API_KEY", api.test_key)
    monkeypatch.setenv("CHECKBOX_API_BASE", api.url)
    exec(compile(_readme_block("Quickstart"), "README-quickstart", "exec"), {"session_params": dict(PARAMS)})
    assert "fail" in capsys.readouterr().out
    exec(compile(_readme_block("Usage"), "README-usage", "exec"), {})
    out = capsys.readouterr().out
    assert "resource_conflict" in out  # a brand-new site is not eligible for a certificate yet
