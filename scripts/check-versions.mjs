#!/usr/bin/env node
// Checks that the npm packages and the Python package carry one version, and (given a tag such as v0.1.0) that the
// tag names it. Used by the release workflow before anything is published.
//
// The CLI (cli/, @checkbox-site/cli) has its own version line, independent of the tag: it is built from Checkbox's
// main codebase and published by the same workflow when its version is not on npm yet. For the CLI this checks that the
// package is well-formed, that the committed bundle reports its version, and that the GitHub Action's default CLI
// version (action.yml) is not newer than it (the Action may only name a CLI this repository has published).
//
//   node scripts/check-versions.mjs [v0.1.0]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const node = JSON.parse(read('node/package.json'));
const mcp = JSON.parse(read('mcp/package.json'));
const pyproject = read('python/pyproject.toml').match(/^version = "([^"]+)"$/m)?.[1];
const pyVersion = read('python/checkbox/_version.py').match(/^VERSION = "([^"]+)"$/m)?.[1];

const versions = {
  [node.name]: node.version,
  [mcp.name]: mcp.version,
  'python/pyproject.toml': pyproject,
  'python/checkbox/_version.py': pyVersion,
};
const problems = [];
const expected = process.argv[2]?.startsWith('v') ? process.argv[2].slice(1) : node.version;
for (const [what, v] of Object.entries(versions)) if (v !== expected) problems.push(`${what} is ${v}, expected ${expected}`);
const dep = mcp.dependencies?.[node.name];
if (dep !== `^${node.version}`) problems.push(`${mcp.name} depends on ${node.name}@${dep}, expected ^${node.version}`);

// --- The CLI: its own version, never compared with the tag. ---
const SEMVER = /^\d+\.\d+\.\d+$/;
const num = (v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
let cliVersion;
if (!existsSync(new URL('../cli/package.json', import.meta.url))) problems.push('cli/package.json is missing (sync the CLI from Checkbox\'s main codebase)');
else {
  const cli = JSON.parse(read('cli/package.json'));
  cliVersion = cli.version;
  if (cli.name !== '@checkbox-site/cli') problems.push(`cli/package.json is named ${cli.name}, expected @checkbox-site/cli`);
  if (!SEMVER.test(String(cli.version))) problems.push(`cli/package.json version ${cli.version} is not x.y.z`);
  if (cli.bin?.checkbox !== 'dist/checkbox.js') problems.push(`cli/package.json bin.checkbox is ${cli.bin?.checkbox}, expected dist/checkbox.js`);
  if (cli.dependencies && Object.keys(cli.dependencies).length) problems.push('cli/package.json has dependencies; the CLI is one self-contained bundle');
  if (!existsSync(new URL('../cli/dist/checkbox.js', import.meta.url))) problems.push('cli/dist/checkbox.js is missing (sync the CLI build)');
  else {
    let ran = '';
    try {
      ran = execFileSync(process.execPath, [fileURLToPath(new URL('../cli/dist/checkbox.js', import.meta.url)), '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      problems.push(`cli/dist/checkbox.js --version failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    }
    if (ran && ran !== cli.version) problems.push(`cli/dist/checkbox.js --version prints ${ran}, expected ${cli.version}`);
  }
  const actionDefault = read('action.yml').match(/^\s{2}version:[\s\S]*?default:\s*"?(\d+\.\d+\.\d+)"?/m)?.[1];
  if (!actionDefault) problems.push('action.yml has no default CLI version');
  else if (SEMVER.test(String(cli.version)) && num(actionDefault) > num(cli.version)) {
    problems.push(`action.yml runs @checkbox-site/cli@${actionDefault} by default, newer than cli/ (${cli.version}): the Action may only name a published CLI`);
  }
}

if (problems.length) {
  console.error(`Version mismatch:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`All packages are at ${expected}.${cliVersion ? ` The CLI (cli/, @checkbox-site/cli) is at ${cliVersion}; it is released on its own version.` : ''}`);
