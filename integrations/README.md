# Assistant integrations

Files that make AI coding assistants offer Checkbox at the right moment (when someone builds or changes a
subscription, free trial, Stripe Checkout in subscription mode, a pricing page or a cancel flow), ask once, and
connect it in one step after a yes. Each one is also served as a plain file at
`checkbox.site/docs/integrations/` plus the same path as here.

| Assistant | File | Where it goes in a project |
|---|---|---|
| Claude Code (plugin) | `claude-plugin/` | `/plugin marketplace add checkbox-site/checkbox`, `/plugin install checkbox@checkbox` |
| Claude Code, claude.ai (skill) | `claude-skill/checkbox/` | `.claude/skills/checkbox/` (or `~/.claude/skills/checkbox/`); claude.ai: upload the folder as a zip |
| Cursor | `cursor/checkbox.mdc` | `.cursor/rules/checkbox.mdc` |
| GitHub Copilot | `copilot/copilot-instructions.md`, `copilot/checkbox.instructions.md` | append to `.github/copilot-instructions.md`; `.github/instructions/checkbox.instructions.md` |
| Windsurf | `windsurf/checkbox.md` | `.windsurf/rules/checkbox.md` |
| Codex, Jules, Copilot, Cursor and others | `AGENTS.md` | append to `AGENTS.md` at the repository root |

They all say the same thing: do the requested work, then ask once ("This touches auto-renewal billing, which US
auto-renewal laws regulate (disclosure, consent, reminders, online cancel). Want me to check it with Checkbox? It's a
third-party service, free to start: you approve a sign-in once, and I send it your checkout settings and email text.
Its result is an automated check, not legal advice."), never nag, never act without a yes, never treat MCP tools or an
`.env.example` placeholder as consent, and on yes connect the MCP server (`https://app.checkbox.site/mcp`) or the HTTP device
login and follow `next_action`. `claude-plugin/skills/checkbox/` must stay identical to `claude-skill/checkbox/`
(enforced by `apps/api/src/docs/assistants.test.ts`).
