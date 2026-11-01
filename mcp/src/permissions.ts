// Which tools a key may see. The API enforces every scope on every call anyway (a tool call with too little access
// returns the API's insufficient_scope / insufficient_role error); hiding tools a key cannot use keeps the tool list
// honest for the model and makes "read-only" keys produce a read-only server.

export type Access = 'read' | 'write';
/** `<resource>:<access>` as in the /v1 restricted-key scopes (apps/api/src/v1/scopes.ts). */
export type ToolScope = `${string}:${Access}`;
export type KeyRole = 'admin' | 'member' | 'viewer';

/** What is known about the key the server acts with. */
export interface KeyContext {
  /** No key at all: only the setup (device login) tool and the docs work. */
  authenticated: boolean;
  /** test / live, or unknown (stdio before the first call). */
  mode: 'test' | 'live' | 'unknown';
  kind?: 'secret' | 'restricted';
  role?: KeyRole;
  /** Restricted keys only: `{ resource: 'read' | 'write' }`. */
  scopes?: Record<string, string> | null;
  /** Hide every write tool regardless of the key (`?read_only=true`, `--read-only`). */
  readOnly?: boolean;
  /**
   * How the remote connection authenticated: an API key in the Authorization header, or an OAuth access token from
   * the one-click connector flow (claude.ai / Claude Desktop / Claude Code / Cursor). With OAuth there is no key to
   * copy or save: setup_checkbox registers the site and runs the first checks straight away.
   */
  auth?: 'api_key' | 'oauth';
  /** OAuth only: the connected app's name as approved by the human (e.g. "Claude"). */
  appName?: string;
}

export const NO_KEY: KeyContext = { authenticated: false, mode: 'unknown' };

/** Whether the key may use one scope (write implies read; viewer keys are read-only). */
export function keyAllows(key: KeyContext, scope: ToolScope): boolean {
  if (!key.authenticated) return false;
  const [resource, access] = scope.split(':') as [string, Access];
  if (access === 'write' && key.readOnly) return false;
  if (access === 'write' && key.role === 'viewer') return false;
  if (key.kind === 'restricted') {
    const granted = key.scopes?.[resource];
    if (!granted) return false;
    return access === 'read' ? granted === 'read' || granted === 'write' : granted === 'write';
  }
  return true;
}

/** Infers the mode and kind from the key prefix (the server confirms with retrieveAccount when it can). */
export function keyContextFromPrefix(apiKey: string | undefined, readOnly = false): KeyContext {
  if (!apiKey) return { ...NO_KEY, readOnly };
  const mode = /^(ck|rk)_test_/.test(apiKey) ? 'test' : /^(ck|rk|sk)_live_/.test(apiKey) ? 'live' : 'unknown';
  const kind = apiKey.startsWith('rk_') ? 'restricted' : 'secret';
  // Restricted keys with unknown scopes: list everything and let the API answer insufficient_scope.
  return { authenticated: true, mode, kind: kind === 'restricted' ? undefined : kind, readOnly };
}
