# Checkbox Python SDK

Automatic-renewal-law compliance (ROSCA, California Bus. & Prof. Code § 17600, New York GBL § 527-a and ~26 other state
laws) for subscription businesses, as an API. Standard library only (`urllib`), Python 3.9+. Free to use.

> **Package name.** `pip install checkbox-sdk` (the name in `pyproject.toml` and in the docs; never install the unrelated
> `checkbox` package). The import name is `checkbox`. In this monorepo: `pip install -e sdks/python`.

## Quickstart

```python
from checkbox import Checkbox
cb = Checkbox()  # reads CHECKBOX_API_KEY, then CHECKBOX_SECRET_KEY (ck_test_… written by `checkbox init`)
check = cb.checks.stripe_checkout_session(params=session_params, merchant={"merchant_name": "Acme", "price": 19.99, "interval": "month"})
print(check["verdict"], check["next_action"]["message"])
params = check["correction"]["corrected_params"] if check["verdict"] == "fail" else session_params  # engine-verified fix
```

No key yet? Connect the MCP server (`setup_checkbox`) or call `POST /v1/device/authorize`: one browser approval creates the account and test keys. Test keys
(`ck_test_…`) act on an isolated sandbox and never need activation.

## What you get

- **Every `/v1` operation** as `cb.<namespace>.<method>()`: `sites`, `checks`, `plans`, `tasks`, `verifications`,
  `findings`, `fixes`, `scans`, `evaluations`, `evidence`, `certificates`, `notice_settings`, `law_updates`,
  `test_runs`, `test_credentials`, `stripe_checkout_configs`, `disclosures`, `consents`, `elements`,
  `domain_verifications`, `setup_sessions`, `device`, `webhook_endpoints`, `events`, `account`. Ids are positional;
  parameters are keyword arguments or a dict: `cb.sites.update("site_…", name="Acme")` or
  `cb.sites.update("site_…", {"name": "Acme"})`.
- **Plain dict responses** with `TypedDict` hints for every object, request and webhook event (`checkbox.types`,
  generated from the OpenAPI spec). `obj.last_response` holds `status_code`, `request_id`, `idempotent_replayed`,
  `headers`.
- **Pagination:** `for f in cb.findings.list(site=site_id).auto_paging_iter(): ...`
- **Retries** on network errors, 409 `idempotency_key_in_use`, 429 (honours `Retry-After`) and 5xx with exponential
  backoff (`max_network_retries`, default 2). **Idempotency keys** are generated for every POST that changes something
  and reused across retries; pass your own with `request_options={"idempotency_key": "…"}`.
- **Versioning:** sends `Checkbox-Version: 2026-10-30`; override with `Checkbox(api_version=…)` or per request.
- **Mode:** `cb.mode` is `"test"` or `"live"` from the key prefix.
- **Typed errors:** `InvalidRequestError`, `AuthenticationError`, `PermissionError`, `RateLimitError`,
  `IdempotencyError`, `APIError`, `APIConnectionError` (all `CheckboxError`) with `code`, `param`, `status_code`,
  `request_id`, `doc_url` and `next_action` (what an agent should do next).
- **Webhooks:** `from checkbox import webhook; webhook.construct_event(raw_body, signature_header, secret)` (as in the docs), or the Stripe-style alias `checkbox.Webhook.construct_event(...)`.
- **Agents / MCP:** `cb.call("verifyTask", {"task": "task_…", "wait": 30})` calls any operation by its operationId with
  flat arguments.

## Usage

```python
from checkbox import Checkbox, CheckboxError

cb = Checkbox(max_network_retries=2, timeout=80, app_info={"name": "my-app", "version": "1.0.0"})

site = cb.sites.create(url="https://acme.example", request_options={"idempotency_key": "site:acme.example"})
plan = cb.plans.retrieve(site["id"])
for task in plan["tasks"]:
    print(task["id"], task["title"], task["next_action"]["description"])

for finding in cb.findings.list(site=site["id"], status="fail").auto_paging_iter():
    print(finding["check_id"], finding["requirements"][0]["citation"] if finding["requirements"] else "")

# Errors carry a stable code and, for agents, next_action.
try:
    cb.certificates.create(site["id"])
except CheckboxError as err:
    # resource_conflict: not eligible yet (verify the domain, keep the site compliant for 7 days);
    # account_not_activated: a live key before any domain is verified.
    print(err.code, err.message, err.next_action)
```

## Webhooks

```python
# Flask
@app.post("/webhooks/checkbox")
def checkbox_webhook():
    try:
        event = checkbox.Webhook.construct_event(request.get_data(), request.headers.get("Checkbox-Signature"), os.environ["CHECKBOX_WEBHOOK_SECRET"])
    except checkbox.SignatureVerificationError as err:
        return {"error": err.message}, 400
    print(event["type"], event["data"]["object"]["id"])
    return {"received": True}
```

Pass the **raw** body (Django `request.body`, FastAPI `await request.body()`). Signatures older than 5 minutes are
rejected (`tolerance=`).

## Examples

[`examples/`](examples/): [preflight a Stripe Checkout Session](examples/compliant_checkout.py) in a
[Flask app](examples/flask_app.py) (with the webhook receiver), and [register a site](examples/register_site.py). The
tests run them against the real API.

## Development (this repository)

- `checkbox/types.py` and `checkbox/_resources.py` are **generated** from `openapi/checkbox.v1.json` by
  `scripts/generate-sdk-types` (`pnpm generate:openapi && pnpm generate:sdk`); do not edit them. The Node test
  `packages/sdk-node/src/generated.test.ts` fails when they are stale.
- Tests: `cd sdks/python && python3 -m pytest`. Unit tests use a local fake HTTP server; `tests/test_live_api.py` and
  `tests/test_examples.py` start the real API (`pnpm exec tsx apps/api/src/testing/serve-sdk-api.ts`) against Postgres
  database `subcomply_test_sdks_py` (reset), and skip when Node/pnpm or Postgres is unavailable.
