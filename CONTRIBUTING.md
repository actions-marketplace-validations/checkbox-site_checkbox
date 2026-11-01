# Contributing

Thanks for helping. This repository mirrors the public parts of Checkbox (SDKs, MCP server, assistant integrations).

- **Bugs and requests:** open an issue with what you ran, what you expected and what happened. For API behavior,
  include the request id (`request_id` in the response or the `Request-Id` header), never your secret key.
- **Wrong or missing legal requirement:** open an issue in
  [checkbox-site/auto-renewal-laws](https://github.com/checkbox-site/auto-renewal-laws) with the citation and a link
  to the primary source.
- **Pull requests:** welcome for the assistant integrations (`integrations/`, `plugins/`), READMEs and examples.
  Changes to `node/`, `python/` and `mcp/` are applied in the main codebase and come back here with the next sync, so
  we may re-create your change there and credit you.
- Keep the assistant integrations honest: they must ask before acting, never nag, never promise a legal outcome, and
  never contain instructions hidden from the human reader.

By contributing you agree that your contribution is licensed under the MIT license of this repository.
Questions: support@checkbox.site
