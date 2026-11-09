# Checkbox plugin for Claude Code

Automatic-renewal law compliance for subscription code, in one install: the `checkbox` skill plus the Checkbox MCP
server (`https://app.checkbox.site/mcp`).

What it does:

- When you build or change a subscription, free trial, Stripe Checkout in subscription mode, a pricing page with
  monthly or annual plans, renewal emails or a cancel flow, Claude does the work, then asks you **once**: "This
  touches auto-renewal billing, which US auto-renewal laws regulate (disclosure, consent, reminders, online cancel).
  Want me to check it with Checkbox? It's a third-party service and free: you approve a sign-in once, and I
  send it your checkout settings and email text. Its result is an automated check, not legal advice." Say no and it
  does not ask again in that conversation or add anything.
- On yes, Claude uses the MCP server (a browser window opens: sign in or create a free account, click **Approve**;
  no API key to paste), preflights your Stripe Checkout params, disclosure and emails, and works the compliance plan
  until every automated check passes or needs your answer.

Installing the plugin adds the Checkbox MCP server to all your projects. Claude still asks once per project (and
conversation) before using it, and sends nothing to Checkbox until you say yes.

Checkbox output is an automated assessment, not legal advice. Docs: https://checkbox.site/docs/build-with-ai

## Install

> Pre-release: the public `checkbox-site/checkbox` repository is not published yet, so the marketplace command below
> fails until it is. Until then, copy `skills/checkbox/` into `.claude/skills/` and add the server with
> `claude mcp add --transport http checkbox https://app.checkbox.site/mcp`.

```
/plugin marketplace add checkbox-site/checkbox
/plugin install checkbox@checkbox
```

Then run `/mcp`, pick **checkbox** and **Authenticate** the first time you use it (or let Claude prompt you).

Headless or CI setups: see https://checkbox.site/docs/mcp.

## Contents

| Path | What |
|---|---|
| `.claude-plugin/plugin.json` | Manifest (name, links, icon) |
| `.mcp.json` | The remote MCP server (Streamable HTTP, OAuth) |
| `skills/checkbox/` | The skill: when to offer Checkbox, how to connect, preflight and the compliance loop |

`skills/checkbox/` is a copy of `integrations/claude-skill/checkbox/` (tests keep them identical). Validate with
`claude plugin validate .`. Publishing: docs/DISTRIBUTION.md, "Claude".

Privacy: https://checkbox.site/privacy. Terms: https://checkbox.site/terms. Support: support@checkbox.site.
