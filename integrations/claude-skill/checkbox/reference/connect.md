# Connecting a project to Checkbox

Only after the user said yes. Pick the first path that works in the current client.

## Contents
- MCP tools already available
- Adding the MCP server (per client)
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

## Adding the MCP server

Ask first; do not do it without a yes. The server signs in with OAuth (a browser window, one **Approve**), so
nothing is copied, stored or shown.

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

- Register the site and get the first plan: `setup_checkbox` does both; then follow `next_action`.
- Preflight before committing: [preflight.md](preflight.md).
- Work the compliance plan: [agent-loop.md](agent-loop.md).
