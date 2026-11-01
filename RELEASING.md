# Releasing

One tag releases everything in this repository at one version:

| Registry | Package | Source |
|---|---|---|
| npm | [`@checkbox-site/node`](https://www.npmjs.com/package/@checkbox-site/node) | [`node/`](node) |
| npm | [`@checkbox-site/mcp`](https://www.npmjs.com/package/@checkbox-site/mcp) (binary `checkbox-mcp`) | [`mcp/`](mcp) |
| PyPI | [`checkbox-site`](https://pypi.org/project/checkbox-site/) (import name `checkbox`) | [`python/`](python) |

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs on a pushed `v*` tag (or by hand from the
Actions tab). It checks that the tag matches every package version, then publishes to npm (with provenance) and to
PyPI. Versions already on a registry are skipped, so a failed run can be re-run.

## Cutting a release

1. Bump the version in `node/package.json`, `mcp/package.json` (and its `@checkbox-site/node` dependency, `^X.Y.Z`),
   `python/pyproject.toml` and `python/checkbox/_version.py`. These files are mirrored from Checkbox's main codebase,
   so the bump normally arrives with a sync.
2. `npm install` (refreshes `package-lock.json`), `npm run build --workspaces`, `node scripts/check-versions.mjs`.
3. Merge to `main` with CI green, then tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

## One-time setup

### npm

The first publish of a package name cannot use trusted publishing (the package does not exist yet), so it uses a
short-lived token; afterwards the workflow authenticates with GitHub's OIDC token and no npm secret is stored.

1. On npmjs.com, create the organization `checkbox-site` (free plan; public packages).
2. Create a **granular access token**: Access Tokens → Generate New Token → Granular Access Token. Expiration: 7 days.
   Packages and scopes: **Read and write**, scope `@checkbox-site`. Organizations: no access. If your account uses 2FA
   for writes, tick **Bypass two-factor authentication** (needed for CI).
3. In this GitHub repository: Settings → Secrets and variables → Actions → New repository secret, name `NPM_TOKEN`,
   value the token.
4. Tag and push `v0.1.0` (above). Both packages are published with provenance.
5. For **each** package (`@checkbox-site/node`, `@checkbox-site/mcp`): npmjs.com → the package → Settings → Trusted
   Publisher → GitHub Actions: organization or user `checkbox-site`, repository `checkbox`, workflow filename
   `release.yml`, environment empty. Save. Optionally set Publishing access to "Require two-factor authentication and
   disallow tokens".
6. Delete the `NPM_TOKEN` repository secret and revoke the token on npmjs.com. Later releases use trusted publishing
   (npm >= 11.5, which the workflow installs).

### PyPI

PyPI uses trusted publishing from the first release (no token).

1. On pypi.org (logged in, 2FA on): Your account → Publishing → **Add a new pending publisher** → GitHub:
   - PyPI Project Name: `checkbox-site`
   - Owner: `checkbox-site`
   - Repository name: `checkbox`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
2. In this GitHub repository: Settings → Environments → New environment `pypi`. Optionally add required reviewers so
   each PyPI upload waits for an approval, and restrict deployments to tags matching `v*`.
3. The first tagged release creates the project on PyPI and the pending publisher becomes a normal one.

## Checks before tagging

```sh
npm ci
npm run build --workspaces
npm run typecheck:examples
node scripts/smoke-mcp.mjs                       # stdio handshake with the built checkbox-mcp
npm pack --dry-run --workspace node              # only dist/, README.md, LICENSE, package.json
npm pack --dry-run --workspace mcp
(cd python && python -m pytest && python -m build)
```
