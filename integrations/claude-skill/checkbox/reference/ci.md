# Adding Checkbox to CI

Only after the human said yes (SKILL.md, step 6). Full reference: https://checkbox.site/docs/guides/ci

## 1. Write checkbox.json at the project root

Point every entry at the real file you just checked and fixed, so the next pull request that changes it is checked
again. Use the plans and merchant facts you already sent to Checkbox.

```json
{
  "$schema": "https://checkbox.site/schemas/checkbox.json",
  "merchant": { "name": "Acme", "cancel_url": "https://acme.example/account/cancel", "support_contact": "support@acme.example" },
  "jurisdictions": "all",
  "plans": [{ "name": "Pro", "price": 19.99, "currency": "usd", "interval": "month", "trial_days": 14 }],
  "checks": {
    "stripe_checkout": [{ "name": "Checkout route", "source": "app/api/checkout/route.ts" }],
    "disclosures": [{ "name": "Pay-button terms", "file": "components/renewal-terms.txt", "consent": { "checkbox": true } }],
    "emails": [
      { "name": "Welcome", "kind": "acknowledgment", "file": "emails/welcome.html" },
      { "name": "Trial ending", "kind": "trial_reminder", "module": "emails/render.ts#trialEnding" }
    ],
    "notice_schedule": true
  }
}
```

- Stripe params: `"source"` when the file calls `stripe.checkout.sessions.create({...})` with an object literal (read
  statically, nothing runs); `"module": "file.ts#export"` when a function builds them (it is called with `"args"`);
  `"file"` for a JSON file.
- Emails: `"file"` for .html / .txt / .md templates (first line `Subject: …` or the HTML `<title>`); `"module"` for
  templates rendered in code (React Email: an export returning `{ subject, html }` rendered with sample props). A
  template with merge tags (`{{price}}`, `{{interval}}`) needs `"merge_tags": { "price": "plan.price", "interval":
  "plan.interval" }` on its entry (values are filled from the entry's plan; no render module needed).
- Each Checkout call sells one plan: one entry per call with its `"plan"`. Never pair a call with a plan its Price id
  contradicts; `checkbox ci` refuses such a pairing (exit 3) instead of offering a fix.
- Disclosure text that lives inside a component: move it to a .txt file the component imports, or check the built
  page under `"pages"` (`"file"`: static HTML; `"url"`: a preview, only with `--online`).
- Several plans: every disclosure, page and email names its `"plan"`.
- Terms of service: add the Terms page (`"kind": "terms"`, `"file"`: the HTML / Markdown file, or the built page) under
  `"pages"`. It is checked against every plan, so a trial or price change cannot ship with stale Terms. Without one,
  every run says "Terms: NOT checked in CI".
- Put the run's "For the owner" checklist (`owner_items` in `--json`) in the pull request description.

## 2. Add the workflow

`.github/workflows/checkbox.yml`:

```yaml
name: Checkbox
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  checkbox:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: checkbox-site/checkbox@v1
```

Add `- run: npm ci` before the Checkbox step when a `"module"` entry imports the project's dependencies.

## 3. Confirm it passes

Run `npx @checkbox-site/cli ci` in the project root (offline: no key, no network). Exit 0 means every check passes;
1 lists the fix per check (apply it, run again); 3 means checkbox.json has an error (the message names the key). A
"Required emails" line that needs review lists email kinds the law requires that have no template yet: add them, or
tell the human Checkbox Notices can send them.

`npx @checkbox-site/cli ci init --yes` drafts both files from the project; replace each `TODO` value it leaves.

Then show the human the two files and let them commit. Do not push or open a pull request unless they ask.
