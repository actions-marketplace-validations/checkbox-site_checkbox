# The agent loop: setup → plan → verify

Each step names the MCP tool first, then the REST call for code that uses the API directly.

## Setup

MCP tool `setup_checkbox` (REST: `POST /v1/setup_sessions`; without OAuth, the device login `POST /v1/device/authorize`)
registers the site and drives a setup session. Over the Checkbox connector (OAuth) there is no key to handle. The
result holds `setup_session`, `site` and `next_action`. After deploying the snippet and policy pages:
`get_setup_status` with `verify: true` (REST: `POST /v1/setup_sessions/{id}/verify`) re-checks and returns the
updated checklist. Setup steps: `account, site, snippet, policies, checks, fixes, lifecycle_test, domain,
owner_notified`, each `done / pending / action_required / skipped / failed`. Stop when `next_action.type` is `done`.

Domain verification: Checkbox only scans websites their owners have verified. The plan's first task is then
`verify_domain`: `verify_task` on it (REST: `POST /v1/tasks/{task}/verify`) starts the check and returns the DNS
record, file and meta tag. Publishing one is the human's job: wait until they say it is done, then `verify_task`
again. Meanwhile check pages by sending their HTML (`check_page_html`, or `verify_task` with `html`).

## Compliance plan

MCP tool `get_compliance_plan` (REST: `GET /v1/sites/{site}/plan`); `get_task` returns one task in full:

- `status`: `action_required` (apply open tasks), `verifying` (only confirmations pending), `blocked` (only human
  answers remain, or a critical/high task was declined), `compliant` (every automated check passes; this is a status
  name, not a legal conclusion: tell the user "Checkbox's checks pass", never "you are compliant").
- `tasks[]` in order. Each: `id` (stable `task_…`), `requirement { citation, plain_language }`, `why` (what was
  observed), `where { kind, file_hint, url, selector, stripe_object }`, `change { type: patch|copy|stripe_params|config|manual, content, edits[] }`,
  `verify { method, how, expected }`, `next_action`.
- Before the first evaluation: `next_action.type = run_first_check` → `verify_site` (REST: `POST /v1/sites/{site}/verify`).

## Apply and verify

1. Apply `task.change` in the code (`get_task` has the full change: diff template, copy or Stripe params).
2. `verify_task` (REST: `POST /v1/tasks/{task}/verify?wait=30`) with what you changed: `html` (the rendered page,
   before deploying), `stripe_checkout_session` (Stripe tasks) or `email { kind, subject, text }`.
3. Result: `passed`, `failed` (with what is still wrong), `not_checked` (evidence is missing, or the domain is not
   verified yet: nothing to change in the code) or `pending` (a scan, billing sync or real email confirms it; poll
   `get_verification` with the verification id, REST `GET /v1/verifications/{id}?wait=30`).
4. Fetch the plan again. Repeat until no automated task is open (`status` `compliant` or `blocked`).

Email tasks ("Send the … email"): by default the merchant's code sends them. Write the email from `check_email`'s
template, add BCC to the address the task names (`…+<kind>@in.checkbox.site`) where the code sends it, then
`verify_task` with `email`. The result stays `pending` until the first real email arrives: continue with the next
task, do not poll. Switching the site to Checkbox Notices (`change.content`, `updateNoticeSettings`) is the human's
decision: ask first.

Shopify stores linked through the Checkbox Shopify app (site `shopify.connection` is `app`): the sign-up task's
change is a call, not code. `publish_shopify_terms` (REST: `POST /v1/sites/{site}/fixes/shopify/publish`) publishes
the verified terms to the app's theme block, writing only the app's own metafield. Then the merchant places the
"Renewal terms + consent" block once with the returned `theme_editor_url`, and you `verify_site`. Installing and
connecting the app is the merchant's job (`shopify_not_connected` says how).

A verification whose `next_action.type` is `retry_later` failed inside Checkbox: nothing to change in the code; move on
and verify again later.

Manual tasks (`change.type: "manual"`) carry a `question`. Ask the human; record their answer with `answer_task`
(REST: `POST /v1/tasks/{task}/answer { "answer": "…" }`). They never block other tasks.

## Synthetic test subscription (Stripe test mode)

The human adds a restricted Stripe TEST key for the site in the Checkbox dashboard (the site's Proof page; live keys
are refused; never ask for it in chat), then `start_test_run` (REST: `POST /v1/sites/{site}/test_runs {}`) and poll
`get_test_run` (REST: `GET /v1/test_runs/{run}`) every 15-30 s. Each step reports what was observed, check results
and a fix. Nothing is charged.
