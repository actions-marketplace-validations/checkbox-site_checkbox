// MCP resources (checkbox://catalog, checkbox://docs/quickstart) and the make_my_checkout_compliant prompt.
import type { CheckboxApi } from './api.ts';

export const CATALOG_URI = 'checkbox://catalog';
export const QUICKSTART_URI = 'checkbox://docs/quickstart';

/** Shape of GET /api/public/coverage (apps/api/src/public-scan/coverage.ts), as far as the summary needs it. */
export interface CoverageDoc {
  catalogVersion: string;
  rulesVersion: string;
  lastVerified: string;
  legalReviewStatus?: string;
  totals: { evaluated: number; upcoming: number; researched: number; none: number; laws: number; requirements: number };
  jurisdictions: Array<{
    code: string;
    name: string;
    coverage: string;
    stages: Record<string, number>;
    laws: Array<{ statute: string; citation: string; sourceUrl?: string; effectiveDate?: string; status: string; summary: string; requirements: number; stages?: Record<string, number>; upcomingEffectiveDate?: string }>;
  }>;
}

const stageList = (s: Record<string, number> | undefined) =>
  Object.entries(s ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');

/** Markdown summary of the legal catalog: what Checkbox evaluates, per jurisdiction. */
export function renderCatalog(doc: CoverageDoc): string {
  const lines = [
    '# Checkbox legal catalog (automatic-renewal / subscription laws)',
    '',
    `Catalog ${doc.catalogVersion}, rules ${doc.rulesVersion}, last verified ${doc.lastVerified}${doc.legalReviewStatus ? `, legal review: ${doc.legalReviewStatus}` : ''}.`,
    `${doc.totals.laws} laws, ${doc.totals.requirements} requirements. Jurisdictions: ${doc.totals.evaluated} evaluated, ${doc.totals.upcoming} upcoming, ${doc.totals.researched} researched but not cataloged, ${doc.totals.none} without a state statute (federal law still applies).`,
    '',
    'Requirements are grouped by lifecycle stage: signup (disclosure + consent at checkout), confirmation (acknowledgment email), reminder (trial / renewal / price-change notices), cancellation (online cancellation, confirmation).',
    'Every check result and compliance task cites the exact requirement (id + citation + official source). Not legal advice.',
    '',
  ];
  for (const j of doc.jurisdictions) {
    if (j.coverage === 'none') continue;
    lines.push(`## ${j.name} (${j.code}) — ${j.coverage}`);
    for (const law of j.laws) {
      const when = law.status === 'enacted_not_yet_effective' ? ` (effective ${law.upcomingEffectiveDate ?? law.effectiveDate})` : law.status === 'not_cataloged' ? ' (researched, not evaluated)' : '';
      lines.push(`- ${law.statute} — ${law.citation}${when}: ${law.requirements} requirement(s)${law.stages ? ` [${stageList(law.stages)}]` : ''}. ${law.summary}${law.sourceUrl ? ` Source: ${law.sourceUrl}` : ''}`);
    }
    lines.push('');
  }
  const none = doc.jurisdictions.filter((j) => j.coverage === 'none').map((j) => j.code);
  if (none.length) lines.push(`No state automatic-renewal statute identified (federal ROSCA / FTC rules still apply): ${none.join(', ')}.`);
  return lines.join('\n');
}

export async function loadCatalog(api: CheckboxApi): Promise<string> {
  const doc = await api.request<CoverageDoc>('GET', '/api/public/coverage', { anonymous: true });
  return renderCatalog(doc);
}

export function quickstartMarkdown(opts: { mcpUrl: string; apiBase: string }): string {
  return `# Checkbox for AI agents — quickstart

Checkbox checks a subscription business against automatic-renewal laws (federal law, 27 states, DC and New York City:
FTC ROSCA, California ARL, New York and the other state laws) and keeps checking it: it watches the checkout, the
acknowledgment / reminder emails and the cancellation flow, stores signed evidence, and tells you — the agent — exactly
what to change. Free. Every feature. No credit card. Fair-use limits.

## The loop (agent-to-agent)

1. **setup_checkbox** — connected through the Checkbox connector (OAuth: claude.ai, Claude Desktop, Claude Code, Cursor)
   the human already approved: it registers the site and runs the first checks at once, no key involved. Without any
   credential (device login) it returns ONE link for the human ("Open … and click Approve"); call it again with the
   device_code (the local stdio server saves the key to the project's git-ignored .env.local itself and shows only a
   hint; prefer OAuth wherever the client supports it). With an API key it starts a setup session. Pass what you know:
   site_url, checkout_url, terms_url / refund_url / cancellation_url, billing_platform, plans, project.layout_file.
   (The \`checkbox init\` CLI, \`npx @checkbox-site/cli init\`, does the same and patches the layout file.)
2. Follow the setup **next_action** (install the snippet on the homepage, pricing, checkout and account pages, store the one Stripe TEST restricted key yourself with store_stripe_test_key,
   register checkout params). After each change: **update_setup**, then **get_setup_status** with verify=true.
3. **get_compliance_plan** — ordered tasks: requirement + citation, where (file / selector / Stripe object), the exact
   change (diff template, copy, or Stripe params) and how to verify.
4. Apply the first open task in the code, then **verify_task** (send the rendered html, the Stripe params or the email
   you changed). Failed → read the diff and fix. Passed / pending → next task.
5. Tasks with status **manual** hold a question for the HUMAN: ask them, then **answer_task**. Never answer for them.
6. **start_test_run** — a synthetic subscription in Stripe test mode (card 4242, Checkbox inbox, test clock through
   trial end and renewal, online cancellation) observes every lifecycle check; **get_test_run** for results.
7. Repeat 3-4 until the checks pass (plan status value \`compliant\`, label "Checks pass"), then Checkbox emails the human a summary by itself (**complete_setup** sends it earlier).
8. A setup in Stripe test mode is not live yet: the plan and complete_setup carry **go_live** (the steps left before
   real customers, with who takes each: verify the domain, the live Stripe key — a person only —, the live checkout,
   promoting the site). Tell the human "set up in test mode; N steps before real customers", never just "done".

Every tool result is a short summary and a compact JSON, ending with "Next: …" naming the tool to call and its arguments; \`verbose: true\` on any tool returns the full API object, and **get_task** has one task in full. Errors carry a stable \`code\` and often a next_action.

## Before shipping code (no site needed)

- **check_disclosure** — disclosure text next to the pay button → verdicts + engine-verified replacement.
- **check_stripe_checkout_session** — the params you pass to stripe.checkout.sessions.create → corrected_params.
- **check_email** — a lifecycle email → verdicts + a template that passes the checks.
- **check_page_html** — the rendered checkout page HTML → verdicts.
- **get_notice_schedule** — when each required notice must be sent for a plan.
- **get_compliant_disclosure** / **get_elements_snippet** — locked wording that passes the checks, or the drop-in
  \`<checkbox-disclosure>\` element that also records consent as evidence.

## Keys and modes

- \`ck_test_…\` keys act on an isolated test-mode sandbox (use them while building). \`ck_live_…\` keys need a verified
  domain before live scans. \`ckr_…\` restricted keys (older ones start with \`rk_…\`) only see the tools their permissions allow; a read-only key gives a
  read-only server. The --read-only flag only hides tools: it is not a security boundary, the key keeps its permissions.
- Keep secret keys server-side (CHECKBOX_SECRET_KEY in .env.local, git-ignored). Publishable keys (\`pk_…\`) are for the
  browser snippet / Elements.

## Connect

- Remote (Streamable HTTP): \`${opts.mcpUrl}\`. MCP clients with OAuth (claude.ai custom connectors, Claude Desktop,
  Claude Code, Cursor) sign in by themselves: the human approves once in the browser, no API key to copy
  (\`claude mcp add --transport http checkbox ${opts.mcpUrl}\`, then /mcp → Authenticate). Or send
  \`Authorization: Bearer <key>\`. Agents without a browser: \`${opts.mcpUrl}?login=device\` offers setup_checkbox's
  device login.
- Local (stdio): the \`checkbox-mcp\` binary (packages/mcp) with CHECKBOX_API_KEY set; without a key it starts with
  setup_checkbox only and switches to the issued key after the human approves (it saves the key to the project's
  git-ignored .env.local itself; the key never appears in the conversation).
- REST: ${opts.apiBase}/v1 — OpenAPI at ${opts.apiBase}/v1/openapi.json.

Automated compliance checks, not legal advice.
`;
}

export interface PromptArgs {
  site_url?: string;
  framework?: string;
  billing_platform?: string;
}

/** The make_my_checkout_compliant prompt: inspect the code → preflight → patch → verify. */
export function makeMyCheckoutCompliantPrompt(args: PromptArgs): string {
  const target = args.site_url ? ` for ${args.site_url}` : '';
  return `Make this project's subscription checkout pass the automatic-renewal checks${target}, using the Checkbox MCP tools. Work autonomously; only stop to ask me (the human) when a tool says a human must decide or approve.

1. Inspect the code first. Find: the framework${args.framework ? ` (expected: ${args.framework})` : ''}, the root layout file, where the subscribe / pay button is rendered, where subscriptions are created (stripe.checkout.sessions.create, payment links, or ${args.billing_platform ?? 'the billing platform'} calls), the plans and prices (amount, interval, trial), the Terms / refund / cancellation policy pages, and which emails are sent to subscribers (acknowledgment, trial / renewal reminders, cancellation confirmation).
2. Preflight before changing anything:
   - check_stripe_checkout_session with the exact params the code passes to Stripe (plus merchant terms when it uses a Price id);
   - check_disclosure with the text next to the pay button (or check_page_html with the rendered checkout HTML);
   - check_email for each subscriber email template, and get_notice_schedule for when reminders must go out.
3. Patch the code with the returned fixes: corrected_params for Stripe, the replacement disclosure + an unchecked, required consent checkbox directly above the pay button (or get_elements_snippet for the drop-in Checkbox Elements component), email templates that pass the checks and send timing, and an online cancellation path. Keep the existing code style; do not invent prices or terms — use the real ones from the code.
4. Re-run the same checks on the patched code until they pass (styling items may stay needs_review until a rendered scan).
5. If Checkbox is not set up for this project yet, call setup_checkbox (one approval link for me), then get_compliance_plan and work the tasks: apply → verify_task → next, until the checks pass (plan status compliant). Ask me any "manual" task questions verbatim; never answer them yourself.
6. Finish with a short summary: what changed (files), which laws/citations each change satisfies, and anything still open.`;
}
