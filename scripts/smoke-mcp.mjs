#!/usr/bin/env node
// Starts the built `checkbox-mcp` binary over stdio without an API key and checks the MCP handshake: initialize,
// then tools/list must offer setup_checkbox. Needs no network.
//
//   node scripts/smoke-mcp.mjs [path/to/bin.js]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = process.argv[2] ?? fileURLToPath(new URL('../mcp/dist/bin.js', import.meta.url));
const env = { ...process.env };
for (const k of ['CHECKBOX_API_KEY', 'CHECKBOX_SECRET_KEY']) delete env[k];
const child = spawn(process.execPath, [bin], { env, stdio: ['pipe', 'pipe', 'inherit'] });

const pending = new Map();
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  }
});
let nextId = 1;
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

const timer = setTimeout(() => {
  console.error('checkbox-mcp did not answer within 20s');
  child.kill();
  process.exit(1);
}, 20_000);

try {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const { tools } = await call('tools/list');
  const names = tools.map((t) => t.name);
  if (!names.includes('setup_checkbox')) throw new Error(`setup_checkbox missing from tools/list: ${names.join(', ')}`);
  console.log(`OK: ${init.serverInfo.name} ${init.serverInfo.version}, tools without a key: ${names.join(', ')}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  child.kill();
}
