// Local stdio MCP server (`checkbox-mcp`) for clients without remote MCP support, or for teams that prefer a local
// process. Reads CHECKBOX_API_KEY (or CHECKBOX_SECRET_KEY, from the environment or the project's .env.local, which
// `checkbox init` and this server's device login write) and calls
// the API over HTTPS — through @checkbox-site/node when it provides a client, else with the built-in fetch client.
// Without a key it starts with setup_checkbox only and switches to the issued key once the human approves.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CheckboxApiError, createHttpApi, DEFAULT_API_BASE, fromSdkClient, type CheckboxApi } from './api.ts';
import { keyContextFromPrefix, type KeyContext } from './permissions.ts';
import { createCheckboxMcpServer, DEFAULT_MCP_URL, SERVER_VERSION } from './server.ts';
import { readSavedKey, saveKeysToProject } from './key-file.ts';

export interface StdioOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  fetch?: typeof fetch;
  /** Diagnostics go to stderr (stdout is the protocol). */
  log?: (line: string) => void;
  /** The project folder the device login saves its keys in (default: the process's working folder). */
  cwd?: string;
}

export interface ResolvedConfig {
  apiKey?: string;
  apiBase: string;
  readOnly: boolean;
}

export function resolveConfig(env: NodeJS.ProcessEnv, argv: string[]): ResolvedConfig {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    return eq?.slice(name.length + 1);
  };
  const apiKey = (flag('--api-key') ?? env.CHECKBOX_API_KEY ?? env.CHECKBOX_SECRET_KEY ?? '').trim() || undefined;
  // Round-4 pilot (sveltekit): CHECKBOX_API_BASE=http://host/v1 requested /v1/v1/…; accept it with or without /v1.
  const apiBase = (flag('--api-base') ?? env.CHECKBOX_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, '').replace(/\/v1$/i, '');
  const readOnly = argv.includes('--read-only') || /^(1|true|yes)$/i.test(env.CHECKBOX_MCP_READ_ONLY ?? '');
  return { ...(apiKey ? { apiKey } : {}), apiBase, readOnly };
}

/** Builds the API client: the Node SDK when it exposes a generic request method, else fetch. */
export async function buildApi(cfg: { apiKey?: string; apiBase: string }, f?: typeof fetch): Promise<CheckboxApi> {
  const http = () => createHttpApi({ ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}), apiBase: cfg.apiBase, userAgent: `checkbox-mcp/${SERVER_VERSION}`, ...(f ? { fetch: f } : {}) });
  if (!cfg.apiKey || f) return http();
  try {
    const sdk = (await import('@checkbox-site/node')) as Record<string, unknown>;
    const Ctor = (sdk.Checkbox ?? sdk.default) as (new (key: string, opts?: Record<string, unknown>) => unknown) | undefined;
    if (typeof Ctor === 'function') {
      const client = new Ctor(cfg.apiKey, { apiBase: cfg.apiBase, baseUrl: cfg.apiBase, appInfo: { name: 'checkbox-mcp', version: SERVER_VERSION } });
      const adapted = fromSdkClient(client, { hasKey: true, apiBase: cfg.apiBase });
      if (adapted) return adapted;
    }
  } catch {
    // SDK not built / not linked: fall through to fetch.
  }
  return http();
}

/** Confirms the key and learns its mode / permissions (retrieveAccount). Falls back to the key prefix. */
export async function describeKey(api: CheckboxApi, apiKey: string | undefined, readOnly: boolean): Promise<KeyContext> {
  const base = keyContextFromPrefix(apiKey, readOnly);
  if (!apiKey) return base;
  try {
    const account = await api.request<{ livemode: boolean; key?: { type: 'secret' | 'restricted'; role: 'admin' | 'member' | 'viewer'; scopes: Record<string, string> | null } }>('GET', '/v1/account');
    return {
      authenticated: true,
      mode: account.livemode ? 'live' : 'test',
      ...(account.key ? { kind: account.key.type, role: account.key.role, scopes: account.key.scopes } : {}),
      readOnly,
    };
  } catch (err) {
    if (err instanceof CheckboxApiError && err.type === 'authentication_error') throw err;
    return base; // restricted key without account:read, or the API is unreachable right now
  }
}

export async function runStdio(opts: StdioOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv.slice(2);
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (argv.includes('--help') || argv.includes('-h')) {
    log(
      [
        'checkbox-mcp — Checkbox MCP server over stdio',
        '',
        'Environment: CHECKBOX_API_KEY (or CHECKBOX_SECRET_KEY) = ck_test_… / ck_live_… / rk_…; CHECKBOX_API_BASE (default https://app.checkbox.site)',
        'Flags: --api-key <key>  --api-base <url>  --read-only (hide every write tool)',
        'Without a key, only setup_checkbox is available: it returns an approval link for the human and adopts the issued key.',
      ].join('\n'),
    );
    return;
  }
  const cfg = resolveConfig(env, argv);
  const cwd = opts.cwd ?? process.cwd();
  // Round 25 (pilot 24 item 12): a key an earlier device login saved in this folder (never shown in the transcript).
  if (!cfg.apiKey) {
    const saved = readSavedKey(cwd);
    if (saved) cfg.apiKey = saved;
  }
  const api = await buildApi(cfg, opts.fetch);
  let key: KeyContext;
  try {
    key = await describeKey(api, cfg.apiKey, cfg.readOnly);
  } catch (err) {
    log(`checkbox-mcp: the API key was rejected (${(err as Error).message}). Starting without a key: use setup_checkbox to get a new one.`);
    key = keyContextFromPrefix(undefined, cfg.readOnly);
  }
  const mcp = createCheckboxMcpServer({
    api: key.authenticated ? api : await buildApi({ apiBase: cfg.apiBase }, opts.fetch),
    key,
    transport: 'stdio',
    mcpUrl: DEFAULT_MCP_URL,
    adoptKeys: async (keys) => {
      const nextApi = await buildApi({ apiKey: keys.secret_key, apiBase: cfg.apiBase }, opts.fetch);
      return { api: nextApi, key: await describeKey(nextApi, keys.secret_key, cfg.readOnly) };
    },
    saveKeys: async (keys) => saveKeysToProject(cwd, keys),
  });
  await mcp.server.connect(new StdioServerTransport());
  log(`checkbox-mcp ${SERVER_VERSION}: ${key.authenticated ? `${key.mode} mode, ${mcp.visibleTools().length} tools` : 'no API key — setup_checkbox only'} (${cfg.apiBase})`);
}
