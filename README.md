# Checkbox

Automatic-renewal law compliance for subscription businesses, as an API, an MCP server and assistant integrations.
Checkbox checks a subscription checkout, its renewal emails and its cancellation flow against US automatic-renewal
laws — federal ROSCA, California Bus. & Prof. Code § 17600 et seq., New York GBL § 527-a and the other state laws —
and returns the exact change to make. Free to start. Checkbox is a System1 company.

- Docs: https://checkbox.site/docs · Docs for agents: https://checkbox.site/llms.txt
- API reference (OpenAPI 3.1): [`openapi/checkbox.v1.json`](openapi/checkbox.v1.json), live at
  https://app.checkbox.site/v1/openapi.json
- Open dataset of the laws: https://github.com/checkbox-site/auto-renewal-laws
- Starter apps: https://github.com/checkbox-site/templates

Checkbox output is an automated assessment, not legal advice. Its rules are drafted from primary sources and are
pending attorney review.

## Use it from your coding assistant

| Assistant | Install |
|---|---|
| Claude Code | `/plugin marketplace add checkbox-site/checkbox` then `/plugin install checkbox@checkbox` ([plugin](plugins/checkbox)) |
| Claude Code, claude.ai (skill only) | copy [`integrations/claude-skill/checkbox`](integrations/claude-skill/checkbox) to `.claude/skills/checkbox/`, or upload it as a zip in claude.ai |
| claude.ai, Claude Desktop | Settings → Connectors → Add custom connector → `https://app.checkbox.site/mcp` |
| Cursor | [`integrations/cursor/checkbox.mdc`](integrations/cursor/checkbox.mdc) → `.cursor/rules/`, MCP `{ "mcpServers": { "checkbox": { "url": "https://app.checkbox.site/mcp" } } }` |
| GitHub Copilot | [`integrations/copilot`](integrations/copilot) → `.github/` |
| Windsurf | [`integrations/windsurf/checkbox.md`](integrations/windsurf/checkbox.md) → `.windsurf/rules/` |
| Codex, Jules and other AGENTS.md readers | append [`integrations/AGENTS.md`](integrations/AGENTS.md) to your `AGENTS.md` |

What they do: when you build or change a subscription, a free trial, Stripe Checkout in subscription mode, a pricing
page or a cancel flow, the assistant asks **once** whether you want it made compliant with US auto-renewal laws. If
you say no, it does not ask again or add anything. If you say yes, it connects Checkbox (one browser approval, free
account), checks your Stripe params, disclosure and emails, and applies the fixes.

## MCP server

Remote Streamable HTTP at `https://app.checkbox.site/mcp` with MCP OAuth (no API key to copy). Registry name
`site.checkbox/checkbox` ([`mcp-registry/server.json`](mcp-registry/server.json)). Source and tool list:
[`mcp/`](mcp). Docs: https://checkbox.site/docs/mcp

## SDKs

| Language | Source | Status |
|---|---|---|
| Node.js / TypeScript (zero dependencies) | [`node/`](node) | Pre-release: the npm name is being finalized; use the HTTP API or MCP meanwhile |
| Python | [`python/`](python) | Pre-release: the PyPI name is being finalized |

Never install the npm package named `checkbox`: it is an unrelated project.

## Repository layout

This repository is a read-only mirror of the public parts of Checkbox's main codebase, updated with each release.
The SDK and MCP sources here reference internal workspace package names until the release build renames them; to
use them today, call the HTTP API or the remote MCP server. Issues and pull requests are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT ([LICENSE](LICENSE)). Security reports: [SECURITY.md](SECURITY.md).
