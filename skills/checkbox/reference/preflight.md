# Preflight checks (stateless)

Use the MCP tools (`check_disclosure`, `check_stripe_checkout_session`, `check_email`, `check_page_html`,
`get_notice_schedule`); the project's own code can call `POST https://app.checkbox.site/v1/checks/<kind>` with its key.
Nothing is stored. Same input + same `as_of` date = same verdicts. CLI: `checkbox check <sub> … --json`
(`--offline` runs the same rules engine locally for every kind except `notice_schedule`).

| kind | Send | Fix to apply |
|---|---|---|
| `disclosure` | `text`, `interval` (required), `price` or `amount`, `trial_days`, `cancel_url`, `merchant_name`, `placement { above_button, same_page_as_payment, font_size_px, contrast_ratio, bold, boxed }`, `consent { checkbox, prechecked, label, required }` | `replacement.disclosure_text`, `replacement.consent_label`, `replacement.html` |
| `stripe_checkout_session` | `params` = exactly the object passed to `stripe.checkout.sessions.create`; `merchant { merchant_name, cancel_url, price, interval }` when `line_items` use a Price id | `correction.patch` (RFC 6902) or `correction.corrected_params` |
| `stripe_payment_link` | `params` = `paymentLinks.create` params or a retrieved link | `correction.patch` |
| `email` | `kind` (`acknowledgment`, `trial_reminder`, `renewal_reminder`, `price_change`, `annual_terms`, `cancellation_confirmation`), `subject`, `text` and/or `html`, `terms { price, interval, cancel_url, … }` | `template { subject, text, html, merge_tags }` |
| `page` | `html` (rendered, after JavaScript) or `url` (live mode, activated account), `terms` | `replacement` |
| `notice_schedule` | `terms`, `start_date`, optional `price_change { effective_date, new_price }` | dates per notice and jurisdiction |

Response (every kind): `verdict` (`pass` / `fail` / `needs_review` / `not_applicable`), `summary`, `checks[]`
(`check_id`, `status`, `severity`, `explanation`, `fix`, `requirements[]` with `citation`), `requirements[]`,
`warnings[]` (about your input, never verdicts), `rules_version`, `catalog_version`, `disclaimer`, `next_action`.

`next_action.type`: `none` (done), `replace_text`, `apply_patch`, `replace_template`, `fix_and_recheck`,
`human_review` (show the human), `provide_input` (send the missing field named in `message`), `schedule_notices`.

Known limits: on any Stripe-hosted page, `signup.disclosure.conspicuous` stays `needs_review` (Stripe controls the
styling): also show the disclosure on your own page before redirecting to Stripe. The static `page` check cannot see
buttons rendered by JavaScript: send the rendered HTML. A passing layout estimate is reported as `needs_review`.

Errors: `{ "error": { "type", "code", "message", "param", "next_action" } }`. `parameter_invalid` / `parameter_missing`
name the `param` to fix. Codes: https://checkbox.site/docs/api/errors.md
