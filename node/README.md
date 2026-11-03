# Checkbox Node.js SDK

Automatic-renewal-law compliance (ROSCA, California Bus. & Prof. Code § 17600, New York GBL § 527-a and ~26 other state
laws) for subscription businesses, as an API. Zero runtime dependencies (global `fetch`; Node 20+, Bun, Deno, edge).
Free to use.

> **Install.** `npm install @checkbox-site/node` (Node 20+). Never install the unscoped npm package `checkbox`: it is an
> unrelated project.

## Quickstart

```ts
import Checkbox from '@checkbox-site/node';
const checkbox = new Checkbox(); // reads CHECKBOX_API_KEY, then CHECKBOX_SECRET_KEY (ck_test_… written by `checkbox init`)
const check = await checkbox.checks.stripeCheckoutSession({ params: sessionParams, merchant: { merchant_name: 'Acme', price: 19.99, interval: 'month' } });
console.log(check.verdict, check.next_action.message);
const params = check.verdict === 'fail' ? check.correction.corrected_params : sessionParams; // engine-verified fix
```

No key yet? Connect the MCP server (`setup_checkbox`) or call `POST /v1/device/authorize`: one browser approval creates the account, writes
`CHECKBOX_SECRET_KEY=ck_test_…` to `.env.local` (the SDK reads it when `CHECKBOX_API_KEY` is not set) and installs the snippet. Test keys (`ck_test_…`) act on an isolated
sandbox and never need activation.

## What you get

| | |
|---|---|
| Resources | `checkbox.<namespace>.<method>()` for every `/v1` operation: `sites`, `checks`, `plans`, `tasks`, `verifications`, `findings`, `fixes`, `scans`, `evaluations`, `evidence`, `certificates`, `noticeSettings`, `lawUpdates`, `testRuns`, `testCredentials`, `stripeCheckoutConfigs`, `disclosures`, `consents`, `elements`, `domainVerifications`, `setupSessions`, `device`, `webhookEndpoints`, `events`, `account` |
| Types | Every request, response and webhook event is typed, generated from `openapi/checkbox.v1.json` (`import type { Site, Finding, WebhookEvent } from '@checkbox-site/node'`). JSDoc on every method and field |
| Pagination | `for await (const f of checkbox.findings.list({ site }))` walks every page; `.autoPagingToArray({ limit })`, `.autoPagingEach(fn)` |
| Retries | Network errors, 409 `idempotency_key_in_use`, 429 (honours `Retry-After`) and 5xx are retried with exponential backoff and jitter (`maxNetworkRetries`, default 2) |
| Idempotency | Every POST that changes something gets an `Idempotency-Key` automatically, reused across retries; pass your own with `{ idempotencyKey }` |
| Versioning | Sends `Checkbox-Version: 2026-10-30` (the version the SDK was generated for); override with `new Checkbox(key, { apiVersion })` or per request |
| Base URL | `new Checkbox(key, { baseUrl: 'http://localhost:4000' })`, or the `CHECKBOX_API_BASE` environment variable (the same one the MCP server reads); a trailing `/v1` is ignored. Default `https://app.checkbox.site` |
| Mode | `checkbox.mode` is `'test'` or `'live'` from the key prefix (`ck_test_` / `ck_live_` / `rk_…` / legacy `sk_live_`) |
| Errors | `CheckboxInvalidRequestError`, `CheckboxAuthenticationError`, `CheckboxPermissionError`, `CheckboxRateLimitError`, `CheckboxIdempotencyError`, `CheckboxAPIError`, `CheckboxConnectionError` (all `CheckboxError`), each with a stable `code`, `param`, `statusCode`, `requestId`, `docUrl` and `nextAction` |
| Webhooks | `checkbox.webhooks.constructEvent(rawBody, signatureHeader, secret)` verifies `Checkbox-Signature` and returns a typed `WebhookEvent`; `constructEventAsync` for edge runtimes |
| Agents / MCP | `checkbox.call('verifyTask', { task, wait: 30 })`: any operation by its operationId with flat arguments (the operation_id of every next_action) |

## Usage

```ts
import Checkbox, { CheckboxError } from '@checkbox-site/node';

const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY, {
  maxNetworkRetries: 2, // default
  timeout: 80_000, // ms per attempt
  appInfo: { name: 'my-app', version: '1.0.0' },
  // baseUrl: 'http://localhost:4000', // API origin (default https://app.checkbox.site); or set CHECKBOX_API_BASE
});

// Register a site (idempotent per key) and read its compliance plan: ordered tasks with the law, the exact change and
// how to verify it. Every plan, task and error carries next_action for an AI agent.
const site = await checkbox.sites.create({ url: 'https://acme.example' }, { idempotencyKey: 'site:acme.example' });
const plan = await checkbox.plans.retrieve(site.id);
for (const task of plan.tasks) console.log(task.id, task.title, task.requirement.citations[0]?.citation);

// Apply a task's change, then verify it (long-poll up to 30 s).
const first = plan.tasks[0];
if (first) {
  const verification = await checkbox.tasks.verify(first.id, { wait: 30 });
  console.log(verification.status, verification.next_action);
}

// Every failing finding across pages.
for await (const finding of checkbox.findings.list({ site: site.id, status: 'fail' })) {
  console.log(finding.check_id, finding.requirements[0]?.citation);
}

// Errors: branch on the stable code; nextAction says what to do.
try {
  await checkbox.certificates.create(site.id);
} catch (err) {
  if (!(err instanceof CheckboxError)) throw err;
  // resource_conflict: not eligible yet (verify the domain, stay compliant for 7 days);
  // account_not_activated: a live key before any domain is verified.
  console.log(err.code, err.message, err.nextAction);
}
```

Per-request options (last argument of every method): `{ idempotencyKey, apiVersion, apiKey, timeout, maxNetworkRetries,
headers, signal }`. Response metadata: `getLastResponse(obj)` → `{ statusCode, requestId, idempotentReplayed, headers }`.
Endpoints newer than your SDK version: `checkbox.request('POST', '/v1/…', { query, body })` or Stripe-style
`checkbox.rawRequest(method, path, params)`.

## Webhooks

```ts
// Next.js App Router: app/api/webhooks/checkbox/route.ts
export async function POST(request: Request) {
  const event = checkbox.webhooks.constructEvent(await request.text(), request.headers.get('checkbox-signature'), process.env.CHECKBOX_WEBHOOK_SECRET!);
  if (event.type === 'plan.updated') console.log(event.data?.object.status);
  return Response.json({ received: true });
}
```

Pass the **raw** body (Express: `express.raw({ type: 'application/json' })`). Signatures older than 5 minutes are
rejected (`tolerance` argument). Several `v1=` entries are accepted, so rolling a secret never drops events.

## Examples

[`examples/`](examples/): preflight a Stripe Checkout Session in a
[Next.js route](examples/nextjs/app/api/checkout/route.ts) or an [Express server](examples/express-checkout.mjs) (shared
logic in [compliant-checkout.ts](examples/compliant-checkout.ts)), [register a site](examples/register-site.ts), and
[verify a webhook](examples/nextjs/app/api/webhooks/checkbox/route.ts). The TypeScript examples are typechecked and run
against the real API in Checkbox's test suite; the quickstart and
usage snippets above are [quickstart.ts](examples/quickstart.ts) and [usage.ts](examples/usage.ts).

## Development

- `npm install` at the repository root, then `npm run build --workspace node` (plain ESM + `.d.ts` in `dist/`) and
  `npm run typecheck:examples`.
- Types and resource methods in `src/generated/` are generated from [`openapi/checkbox.v1.json`](../openapi/checkbox.v1.json)
  in Checkbox's main codebase and mirrored here with each release; see [CONTRIBUTING.md](../CONTRIBUTING.md).
- Releases: [RELEASING.md](../RELEASING.md).
