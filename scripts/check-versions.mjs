#!/usr/bin/env node
// Checks that the npm packages and the Python package carry one version, and (given a tag such as v0.1.0) that the
// tag names it. Used by the release workflow before anything is published.
//
//   node scripts/check-versions.mjs [v0.1.0]
import { readFileSync } from 'node:fs';

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

if (problems.length) {
  console.error(`Version mismatch:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`All packages are at ${expected}.`);
