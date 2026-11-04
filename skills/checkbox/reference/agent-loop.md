# The agent loop: setup → plan → verify

## Setup

MCP tool `setup_checkbox` (or `POST /v1/device/authorize`; CLI `checkbox init --yes --json`, pre-release) runs a device login (the human clicks Approve once),
writes keys, installs the snippet and drives a setup session. The JSON result holds `setup_session`, `site` and
`next_action`. After deploying the snippet and policy pages: `get_setup_status` with verify=true (CLI `checkbox init --verify --yes --json`) (re-checks and
returns the updated checklist). Setup steps: `account, site, snippet, policies, checks, fixes, lifecycle_test, domain,
owner_notified`, each `done / pending / action_required / skipped / failed`. Stop when `next_action.type` is `done`.

## Compliance plan

`GET /v1/sites/{site}/plan` (`checkbox plan --json`):

- `status`: `action_required` (apply open tasks), `verifying` (only confirmations pending), `blocked` (only human
  answers remain, or a critical/high task was declined), `compliant` (every automated check passes; this is a status
  name, not a legal conclusion: tell the user "Checkbox's checks pass", never "you are compliant").
- `tasks[]` in order. Each: `id` (stable `task_…`), `requirement { citation, plain_language }`, `why` (what was
  observed), `where { kind, file_hint, url, selector, stripe_object }`, `change { type: patch|copy|stripe_params|config|manual, content, edits[] }`,
  `verify { method, how, expected }`, `next_action`.
- Before the first evaluation: `next_action.type = run_first_check` → call `POST /v1/sites/{site}/verify`.

## Apply and verify

1. Apply `task.change` in the code (for `patch` tasks, `checkbox fix <task> --file <path>` prints an exact diff).
2. `POST /v1/tasks/{task}/verify?wait=30` with what you changed: `{ "html": "<rendered page>" }` (page tasks before
   deploying), `{ "stripe_checkout_session": { …params } }` (Stripe tasks) or `{ "email": { "kind", "subject", "text" } }`.
   CLI: `checkbox verify <task> --wait --json`.
3. Result: `passed`, `failed` (with what is still wrong) or `pending` (a scan, billing sync or real email confirms it;
   poll `GET /v1/verifications/{id}?wait=30` or wait for the `task.verified` webhook).
4. Fetch the plan again. Repeat until no automated task is open (`status` `compliant` or `blocked`).

Manual tasks (`change.type: "manual"`) carry a `question`. Ask the human; record their answer with
`POST /v1/tasks/{task}/answer { "answer": "…" }`. They never block other tasks.

## Synthetic test subscription (Stripe test mode)

The human adds a restricted Stripe TEST key for the site in the Checkbox dashboard (Site settings, Stripe test key;
live keys are refused; never ask for it in chat), then `POST /v1/sites/{site}/test_runs {}` and poll `GET /v1/test_runs/{run}` every 15-30 s.
Each step reports what was observed, check results and a fix. Nothing is charged.
