# Checkbox

Check a subscription checkout's renewal terms in one command. Offline: no account, no key, nothing leaves your machine.

```bash
npx @checkbox-site/cli check disclosure --offline \
  --text '$19.99 per month.' --price 19.99 --interval month \
  --merchant-name Acme --cancel-url https://acme.example/cancel --consent-checkbox --bold
```

```text
FAIL  disclosure · all jurisdictions · rules 1.4.0 · catalog 2026.11.09.3 · offline
  ✗ signup.disclosure.autorenew_language (critical)
  ✓ signup.disclosure.price (critical)
  ✓ signup.disclosure.frequency (critical)
  ✗ signup.disclosure.cancellation_policy (critical)
  ✓ signup.disclosure.term_length (critical)
  ? signup.disclosure.proximity (critical)
  ? signup.disclosure.conspicuous (critical)
  ? signup.consent.affirmative (critical)
  ✓ signup.consent.not_prechecked (critical)

Suggested replacement (passes the checks) (verified by the rules engine)
  disclosure:     Renews automatically every month at $19.99 (plus applicable taxes) until you cancel. Cancel anytime online at
                  https://acme.example/cancel before your next billing date to avoid the next charge.
  checkbox:       I agree that my Acme subscription renews automatically every month at $19.99 (plus applicable taxes) until I
                  cancel, and I understand I can cancel anytime online at https://acme.example/cancel.
```

The output is abridged: the full run also prints each failing check's reason and fix, and a fuller version of the
line. ✓ passes · ✗ fails · ? needs review. More offline checks: https://checkbox.site/docs/cli#offline

## What it is

Automatic-renewal law compliance for subscription businesses, as an API, an MCP server and assistant integrations.
Checkbox checks a subscription checkout, its renewal emails and its cancellation flow against US automatic-renewal
laws — federal ROSCA, California Bus. & Prof. Code § 17600 et seq., New York GBL § 527-a and the other state laws —
and returns the exact change to make. Free. Checkbox is a System1 company.

- Docs: https://checkbox.site/docs · Docs for agents: https://checkbox.site/llms.txt
- API reference (OpenAPI 3.1): [`openapi/checkbox.v1.json`](openapi/checkbox.v1.json), live at
  https://app.checkbox.site/v1/openapi.json
- Open dataset of the laws: https://github.com/checkbox-site/auto-renewal-laws
- Starter apps: https://github.com/checkbox-site/templates

Rules drafted from the statute text and updated as new statutes come into effect. Automated checks, not legal advice.
Every rule cites its source, so you or your lawyer can check it.

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

## GitHub Action: compliance checks on every pull request

Describe what to check in `checkbox.json` (the merchant, your plans, and the files that produce the Stripe Checkout
params, the disclosure, checkout / pricing pages and lifecycle emails), then add the Action. It runs the Checkbox
rules engine offline (no API key, nothing leaves the runner), annotates the lines that need a fix and writes a job
summary with the corrected params / text. [`action.yml`](action.yml) ·
[example workflow](examples/github-action/checkbox.yml) · CLI: [`@checkbox-site/cli`](cli) · Docs:
https://checkbox.site/docs/guides/ci

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: checkbox-site/checkbox@v1
    # with: { strict: true, config: checkbox.json, working-directory: ., args: --changed-only }
```

`npx @checkbox-site/cli ci init --yes` writes a first `checkbox.json` and the workflow from your project. Inputs:
`config` (default `checkbox.json`), `strict` (`false`), `working-directory` (`.`), `args`, `version` (the CLI version),
`node-version` (`22`). Output: `status` (`pass`, `fail`, `needs_review`, `error`, `skipped`).

## MCP server

Remote Streamable HTTP at `https://app.checkbox.site/mcp` with MCP OAuth (no API key to copy). Registry name
`site.checkbox/checkbox` ([`mcp-registry/server.json`](mcp-registry/server.json)). Source and tool list:
[`mcp/`](mcp). Docs: https://checkbox.site/docs/mcp

Local stdio server for clients without remote MCP support: `npx -y @checkbox-site/mcp` (binary `checkbox-mcp`).

## SDKs

| Language | Package | Source |
|---|---|---|
| Node.js / TypeScript (zero dependencies) | `npm install @checkbox-site/node` | [`node/`](node) |
| Python 3.9+ (standard library only) | `pip install checkbox-site` (import `checkbox`) | [`python/`](python) |

Never install the npm package named `checkbox` or the PyPI packages `checkbox` / `checkbox-sdk`: they are unrelated
projects.

## Repository layout

This repository mirrors the public parts of Checkbox's main codebase and is updated with each release: `node/`,
`mcp/` (npm workspaces), `python/`, `openapi/`, `integrations/`, `plugins/`, `mcp-registry/`, the GitHub Action
(`action.yml`) and the CLI's README (`cli/`; the CLI is built and published from the main codebase). Releases are
published from tags by GitHub Actions ([RELEASING.md](RELEASING.md)). Issues and pull requests are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT ([LICENSE](LICENSE)). Security reports: [SECURITY.md](SECURITY.md).
