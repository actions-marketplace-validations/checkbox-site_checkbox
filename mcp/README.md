# Checkbox MCP server

<!-- mcp-name: site.checkbox/checkbox -->

Auto-renewal law checks (ROSCA, click-to-cancel, automatic renewal laws) for Stripe Checkout, cancellation flows and renewal reminder emails, for AI coding agents. Connect Claude, Cursor, VS Code or any MCP client to Checkbox and
your agent can set up a project with one human click, check checkout code before it ships, work the compliance plan to
done and run synthetic test subscriptions — against ROSCA, California's Automatic Renewal Law, New York GBL § 527-a
and the other state automatic-renewal laws.

Docs: https://checkbox.site/docs/mcp · Agent index: https://checkbox.site/llms.txt · Free. Every feature. No credit card. Fair-use limits.

## Connect

**Remote (recommended)** — Streamable HTTP at `https://app.checkbox.site/mcp`, nothing to install, no API key to copy:
the server implements MCP OAuth, so your client opens a Checkbox sign-in and you click **Approve** once.

- claude.ai / Claude Desktop: Settings → Connectors → **Add custom connector** → `https://app.checkbox.site/mcp` →
  Connect → Approve.
- Claude Code: `claude mcp add --transport http checkbox https://app.checkbox.site/mcp`, then `/mcp` → Authenticate.
- Cursor (`.cursor/mcp.json`): `{ "mcpServers": { "checkbox": { "url": "https://app.checkbox.site/mcp" } } }`, then
  Connect.

API keys still work everywhere (CI, headless agents): add `--header "Authorization: Bearer $CHECKBOX_SECRET_KEY"`
(Claude Code) or `"headers": { "Authorization": "Bearer ${env:CHECKBOX_SECRET_KEY}" }` (Cursor). Agents without a
browser: `https://app.checkbox.site/mcp?login=device` offers `setup_checkbox`, which returns an approval link and then
test-mode keys.

**Local (stdio)** — for clients without remote MCP support:

```json
{
  "mcpServers": {
    "checkbox": {
      "command": "npx",
      "args": ["-y", "@checkbox-site/mcp"],
      "env": { "CHECKBOX_API_KEY": "ck_test_..." }
    }
  }
}
```

Package: `@checkbox-site/mcp` on npm (Node 20+; binary `checkbox-mcp`). Options:
`--read-only` (hides write tools; not a security boundary, the key keeps its permissions: use a read-only `ckr_…` key to limit it), `--api-key`, `--api-base`; environment `CHECKBOX_API_KEY` (falls back to `CHECKBOX_SECRET_KEY`),
`CHECKBOX_API_BASE`, `CHECKBOX_MCP_READ_ONLY=true`.

## Tools

Start with `setup_checkbox`; then `get_compliance_plan` → apply a task → `verify_task`, until the checks pass (plan status `compliant`).
Preflight tools (`check_disclosure`, `check_stripe_checkout_session`, `check_email`, `check_page_html`,
`get_notice_schedule`) work on code before it is deployed. The full list, with the API operation behind each tool, is
at https://checkbox.site/docs/mcp#tools.

Every tool is a thin call to the public API (`https://app.checkbox.site/v1`), so keys, scopes, test/live mode and rate
limits are the API's. Write tools say so and carry `readOnlyHint: false`. Results are written for models and end with
the next tool to call.

## Not legal advice

Rules drafted from the statute text and updated as new statutes come into effect. Automated checks, not legal advice. Every rule cites its source, so you or your lawyer can check it.

## License

MIT
