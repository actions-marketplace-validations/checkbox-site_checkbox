# `checkbox` CLI (`@checkbox-site/cli`)

Subscription compliance checks for auto-renewal law (automatic renewal laws: ROSCA, click-to-cancel, California ARL, New
York GBL § 527-a and the other state laws) on Stripe Checkout, cancellation flows and renewal reminder emails, from a
terminal, a CI job or an AI coding agent. Node 20+.

```sh
npx @checkbox-site/cli ci init --yes      # checkbox.json + .github/workflows/checkbox.yml from your project
npx @checkbox-site/cli ci                 # run every check in checkbox.json (offline: no key, no network)
```

Never install the unscoped npm package `checkbox`: it is an unrelated project. The binary this package installs is
called `checkbox`:

```sh
checkbox check disclosure --text "…" --price 19.99 --interval month --consent-checkbox --offline
checkbox check stripe-session --file session-params.json --cancel-url https://example.com/account/cancel --offline
checkbox check email --kind trial_reminder --file emails/trial-ending.txt --price 19.99 --interval month --trial-days 14
checkbox check page --file dist/checkout.html --price 19.99 --interval month
checkbox init                             # connect this project to a Checkbox account (one browser approval)
```

Every command prints short human output, or exactly one JSON document with `--json` (what agents should use).

## `checkbox ci` — checks on every code change

`checkbox.json` at the project root lists what to check: the merchant, the plans the checkout sells, and the files
that produce the Stripe Checkout params, the disclosure next to the pay button, checkout / pricing pages and the
lifecycle emails. `checkbox ci` runs every check with the rules engine bundled in this package (offline by default;
`--online` uses the API with `CHECKBOX_SECRET_KEY`, for preview URLs), prints one line per check and exits non-zero
when one needs a fix. In GitHub Actions it annotates the file each check reads and writes a job summary with the fix
and the corrected params / text.

```json
{
  "$schema": "https://checkbox.site/schemas/checkbox.json",
  "merchant": { "name": "Acme", "cancel_url": "https://acme.example/account/cancel" },
  "plans": [{ "name": "Pro", "price": 19.99, "currency": "usd", "interval": "month", "trial_days": 14 }],
  "checks": {
    "stripe_checkout": [{ "name": "Pro checkout", "source": "app/api/checkout/route.ts" }],
    "emails": [{ "name": "Welcome email", "kind": "acknowledgment", "file": "emails/welcome.html" }],
    "notice_schedule": true
  }
}
```

GitHub Actions (`.github/workflows/checkbox.yml`, written by `checkbox ci init`):

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: checkbox-site/checkbox@v1
```

Config reference, exit codes and an example summary: https://checkbox.site/docs/guides/ci

## Exit codes (stable)

| Code | Meaning |
|---|---|
| 0 | OK (checks: everything passed — or only `needs_review` without `--strict`) |
| 1 | A compliance check failed |
| 2 | A check needs review and `--strict` was given |
| 3 | Usage or config error (unknown command / flag, invalid checkbox.json, missing file) |
| 4 | Not logged in / API key rejected |
| 5 | API, network or local error |

## Credentials

Only `--online` checks and the account commands need a key. Resolution order: `--api-key` flag → `CHECKBOX_API_KEY`
→ `CHECKBOX_SECRET_KEY` (environment) → `CHECKBOX_SECRET_KEY` in this project's `.env.local` / `.env` /
`.checkbox/keys.env` (the working folder, then parent folders up to the repository root) → the key saved by `checkbox login` (`~/.config/checkbox/config.json`, honouring
`XDG_CONFIG_HOME`; `CHECKBOX_CONFIG_DIR` overrides; file mode 0600). The API base is `--api-base` →
`CHECKBOX_API_BASE` → stored `api_base` → `https://app.checkbox.site`. When a project key and a different saved login
both exist, the CLI prints which one it used (stderr), and `checkbox whoami` shows `key_source` and `key_file`.

| Command | What it does |
|---|---|
| `checkbox init [--yes] [--json]` | one browser approval (device login), then keys in `.env.local` (not when that file is tracked by git or the folder is deployed as it is: the key then stays only in `~/.config/checkbox/config.json`), the SRI-pinned snippet in the root layout, site + Terms / policies registered, Stripe test subscription (with permission; only a Stripe restricted TEST key, `rk_test_…` in `STRIPE_RESTRICTED_KEY`, is used: `sk_test_` and live keys are refused with how to make one), first checks, owner email; `--verify` re-checks after a deploy; `--ci` only adds CI (`checkbox ci init`) |
| `checkbox login [--api-key <key>\|--stdin]` | verifies the key with `GET /v1/account`, then saves it |
| `checkbox whoami` | account, mode (test/live) and where the key came from |
| `checkbox logout` | forgets the stored key |

## `checkbox check` (preflight — "check before you ship")

Stateless checks an agent runs while writing checkout code, before anything is deployed. Online they call
`POST /v1/checks/*`; with `--offline` the same rules engine runs locally and prints the identical JSON (plus
`"mode": "offline"`). Verdicts always come from the Checkbox rules engine and legal catalog; every result carries
`rules_version`, `catalog_version` and a `disclaimer` (not legal advice).

| Sub-command | API | Offline |
|---|---|---|
| `disclosure` | `POST /v1/checks/disclosure` | yes |
| `stripe-session` | `POST /v1/checks/stripe_checkout_session` | yes |
| `payment-link` | `POST /v1/checks/stripe_payment_link` | yes |
| `email` | `POST /v1/checks/email` | yes |
| `page` | `POST /v1/checks/page` (`--url` needs an activated live account) | `--file` only |
| `notice-schedule` | `POST /v1/checks/notice_schedule` | no |

Run `checkbox check <sub> --help` for flags. Common flags: `--jurisdictions US-CA,US-NY` (default all),
`--strict` (needs_review exits 2), `--json`, `--offline`, `--body <file.json>` (send a complete request body as-is).

## `checkbox plan` / `fix` / `verify` (the compliance-plan loop)

```
checkbox plan --json                      # ordered tasks + next_action (GET /v1/sites/:site/plan)
checkbox fix task_… [--file src/x.tsx]    # the change; for code tasks an exact unified diff of your file (never written)
checkbox verify task_… --wait             # pre-check now, then wait for the confirming scan / email / sync
checkbox verify --wait                    # re-check the whole site
```

The site comes from `--site`, `$CHECKBOX_SITE`, what `checkbox init` saved for this directory, or your only site.
`fix --out fix.diff` also writes the diff for `git apply`. `verify` accepts `--html-file` (pre-deploy HTML),
`--stripe-params <json>` and `--email-file <json>`. Exit codes: `plan --exit-code` 1 until the checks pass; `verify` 0 passed
or passed with notes (counts as passing; the note is about something outside your code), 1 failed, 2 not settled yet
(still pending, needs review, not checked yet, live check pending, or passed with gaps: some checks were not observed
yet, so the task is not verified). Docs: https://checkbox.site/docs/cli

Not legal advice: Checkbox is an automated check against its catalog of automatic-renewal laws.
