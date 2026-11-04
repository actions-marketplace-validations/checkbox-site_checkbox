# What the checks mean

Check ids are stable. Each maps to legal requirements with citations (see a check result's `requirements[]`). The
current list with the laws behind each: https://checkbox.site/docs/concepts/checks.md

| Stage | What the law asks (in short) | Check ids |
|---|---|---|
| Sign-up | Before payment, clearly and conspicuously, in visual proximity to the pay button: that it renews automatically until cancelled, the price, how often it is charged, the length of the term, the trial and what is charged after it, and how to cancel | `signup.disclosure.autorenew_language`, `.price`, `.frequency`, `.term_length`, `.trial_terms`, `.cancellation_policy`, `.proximity`, `.conspicuous` |
| Sign-up | Affirmative consent to those terms before charging; consent boxes not pre-checked | `signup.consent.affirmative`, `signup.consent.not_prechecked` |
| Acknowledgment | An email (or other retainable) acknowledgment after sign-up with the terms, the cancellation policy and how to cancel, and the trial terms | `confirmation.*` |
| Reminders | Notice before a free trial converts, before renewals of longer terms, before price changes, and some states' yearly or per-charge notices, inside each state's window | `reminder.*` |
| Cancellation | Cancel online, in the medium used to sign up, without obstruction (no forced call or chat; offers only with a visible way to finish); confirmation of the cancellation | `cancel.*` |
| Billing settings | The billing platform lets customers cancel online and sends trial reminders | `config.*` |
| Policies | Terms of service consistent with the renewal and cancellation terms; refund promises not contradicted | `terms.*` |

Each check's status is passing, `fail`, `needs_review` (not enough evidence, or a human must judge) or `not_applicable`. A check never
passes for lack of data. Severity: `critical`, `high`, `medium`, `low` (the strictest applicable requirement).

Jurisdictions: `US-FED` always applies; states use `US-CA`, `US-NY`, … (set `jurisdictions` to limit a check;
default all). New York's notice-channel and price-increase consent requirements cannot be observed: they become
`manual` tasks for the human to attest.
