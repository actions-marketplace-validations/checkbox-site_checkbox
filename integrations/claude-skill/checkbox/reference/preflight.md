# Preflight checks (stateless)

Use the MCP tools (`check_disclosure`, `check_stripe_checkout_session`, `check_email`, `check_page_html`,
`get_notice_schedule`); the project's own code can call `POST https://app.checkbox.site/v1/checks/<kind>` with its key.
Nothing is stored. Same input + same `as_of` date = same verdicts: plan terms come only from the request (the one
lookup: a Stripe Price id in `line_items` is read from the account's connected Stripe account; pass `merchant.price`
to skip it). When the terms are missing, the check asks for them (`provide_input`) instead of guessing.

| kind | Send | Fix to apply |
|---|---|---|
| `disclosure` | `text`, `interval` (required), `price` or `amount`, `trial_days`, `cancel_url`, `merchant_name`, `placement { above_button, same_page_as_payment, font_size_px, contrast_ratio, bold, boxed }`, `consent { checkbox, prechecked, label, required }` | `replacement.disclosure_text`, `replacement.consent_label`, `replacement.html` |
| `stripe_checkout_session` | `params` = exactly the object passed to `stripe.checkout.sessions.create` (a free trial is `subscription_data.trial_period_days`); `merchant { merchant_name, cancel_url, price, interval }` when `line_items` use a Price id | `correction.patch` (RFC 6902) or `correction.corrected_params` |
| `stripe_payment_link` | `params` = `paymentLinks.create` params or a retrieved link | `correction.patch` |
| `email` | `kind` (`acknowledgment`, `trial_reminder` (= `trial_ending`), `renewal_reminder`, `price_change`, `annual_terms`, `charge_notice`, `cancellation_confirmation`), `subject`, `text` and/or `html`, `terms { price, interval, cancel_url, … }` | `template { subject, text, html, merge_tags }` |
| `page` | `html` (rendered, after JavaScript) or `url` (live mode, activated account), `terms` | `replacement` |
| `notice_schedule` | `terms`, `start_date`, optional `price_change { effective_date, new_price }` | dates per notice and jurisdiction |

Response (every kind): `verdict` (`pass` / `fail` / `needs_review` / `not_applicable`), `summary`, `checks[]`
(`check_id`, `status`, `severity`, `explanation`, `fix`, `requirements[]` with `citation`), `requirements[]`,
`warnings[]` (about your input, never verdicts), `rules_version`, `catalog_version`, `disclaimer`, `next_action`.

`next_action.type`: `none` (done), `replace_text`, `apply_patch`, `replace_template`, `fix_and_recheck`,
`human_review` (show the human), `provide_input` (send the missing field named in `message`), `schedule_notices`.

Known limits: on any Stripe-hosted page, `signup.disclosure.conspicuous` stays `needs_review` (Stripe controls the
styling): also show the disclosure on your own page before redirecting to Stripe. For `disclosure`, describe the
styling you used: `replacement.html` is semibold, so after applying it pass `placement.bold: true`; when only
conspicuousness is left, ask the human to confirm it by eye instead of re-applying the replacement. The static `page` check cannot see
buttons rendered by JavaScript: send the rendered HTML. A passing layout estimate is reported as `needs_review`.

Errors: `{ "error": { "type", "code", "message", "param", "next_action" } }`. `parameter_invalid` / `parameter_missing`
name the `param` to fix. Codes: https://checkbox.site/docs/api/errors.md
