# Connecting a project to Checkbox

Only after the user said yes. Pick the first path that works in the current client.

## Contents
- MCP tools already available
- HTTP device login (any agent that can run commands)
- Adding the MCP server for next time (per client)
- Chat-only clients (claude.ai, Claude Desktop)
- After connecting

## MCP tools already available

If a tool named `setup_checkbox` exists (Claude Code shows it as `mcp__checkbox__setup_checkbox`, or
`mcp__plugin_checkbox_checkbox__setup_checkbox` when it comes from the Checkbox plugin), call it with what the code
tells you:

```json
{
  "site_url": "https://example.com",
  "checkout_url": "https://example.com/checkout",
  "merchant_name": "Example",
  "plans": [{ "name": "Pro", "amount": 1900, "currency": "usd", "interval": "month", "trial_days": 14 }],
  "account_url": "https://example.com/account",
  "terms_url": "https://example.com/terms",
  "billing_platform": "stripe",
  "agent": "Claude Code"
}
```

Leave out what you do not know rather than guessing. On a local project use the dev URL (`http://localhost:3000`):
`localhost` sites need no domain verification in test mode. Show the human any link the result asks them to open.

## HTTP device login

Works immediately, without restarting the client:

```bash
curl -sS https://app.checkbox.site/v1/device/authorize \
  -H "Content-Type: application/json" \
  -d '{"client":{"name":"agent","agent":"Claude Code"},"site_url":"http://localhost:3000"}'
```

1. Show the human `verification_uri_complete` (and `user_code`) and ask them to open it and click **Approve**.
   That page also creates a free account. This is the only human step.
2. Poll every `interval` seconds until it stops answering `authorization_pending` (back off on `slow_down`). Do not
   print the response: it contains the secret key. Write it straight to the env file the project loads instead
   (`.env.local` for Next.js and Vite, `.env` for dotenv/Express; check it is git-ignored first):

   ```bash
   curl -sS https://app.checkbox.site/v1/device/token \
     -H "Content-Type: application/json" -d '{"device_code":"<device_code>"}' > .checkbox-token.json
   jq -r '.error.code // empty' .checkbox-token.json   # authorization_pending, slow_down, expired_token, access_denied
   ```

   Once there is no `error.code`, read `next_action`, append the keys and delete the file:

   ```bash
   jq '{next_action, site, setup_session}' .checkbox-token.json
   jq -r '"CHECKBOX_SECRET_KEY=" + .secret_key, "CHECKBOX_PUBLISHABLE_KEY=" + .publishable_key' \
     .checkbox-token.json >> .env.local && rm .checkbox-token.json
   ```

   On `expired_token` or `access_denied`, delete the file, stop and tell the human; do not retry silently.
3. Use the framework's public prefix for the publishable key where needed (such as
   `NEXT_PUBLIC_CHECKBOX_PUBLISHABLE_KEY`). Never echo the secret key back to the user.
4. Follow the `next_action` you read in step 2.

API calls then authenticate with `Authorization: Bearer $CHECKBOX_SECRET_KEY`.

## Adding the MCP server for next time

Offer this; do not do it without asking. The server signs in with OAuth (a browser window, one **Approve**), so no
key is copied.

| Client | How |
|---|---|
| Claude Code | `claude mcp add --transport http checkbox https://app.checkbox.site/mcp`, then `/mcp`, pick checkbox, Authenticate. Or install the Checkbox plugin, which bundles this skill and the server |
| Cursor | Add `{ "mcpServers": { "checkbox": { "url": "https://app.checkbox.site/mcp" } } }` to `.cursor/mcp.json`, then Connect in Cursor's MCP settings |
| VS Code (Copilot agent mode) | `.vscode/mcp.json`: `{ "servers": { "checkbox": { "type": "http", "url": "https://app.checkbox.site/mcp" } } }` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json`: `{ "mcpServers": { "checkbox": { "serverUrl": "https://app.checkbox.site/mcp" } } }` |
| Codex CLI | `~/.codex/config.toml`: `[mcp_servers.checkbox]` with `url = "https://app.checkbox.site/mcp"` |

All clients: https://checkbox.site/docs/mcp

## Chat-only clients

In claude.ai or Claude Desktop the user adds the connector themselves: Settings, Connectors, Add custom connector,
URL `https://app.checkbox.site/mcp`, then Connect and Approve. Until then, you can still give them the requirements in
SKILL.md section 5 and review code they paste.

## After connecting

- Register the site and get the first plan: `setup_checkbox` does both; over HTTP follow `next_action`.
- Preflight before committing: [preflight.md](preflight.md).
- Work the compliance plan: [agent-loop.md](agent-loop.md).
