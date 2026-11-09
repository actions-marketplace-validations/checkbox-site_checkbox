// Round 21 (pilot 20 item 5: testers ran @checkbox-site/mcp 0.1.1 from npm against an API that named arguments and
// operations 0.1.1 does not have, and nothing told them to update). Every /v1 response says which MCP server version
// the API expects (MCP_MIN_VERSION_HEADER); a local server older than that tells the agent, with the update command.

/** Response header on every /v1 response: the oldest @checkbox-site/mcp the API is written for. */
export const MCP_MIN_VERSION_HEADER = 'checkbox-mcp-minimum-version';

/**
 * The oldest @checkbox-site/mcp the API is written for. Raise it (with SERVER_VERSION) when the API adds arguments or
 * operations that next_action / task text tells agents to use.
 */
export const MCP_MINIMUM_VERSION = '0.2.0';

/** How a person updates the local server (what the README's config runs). */
export const MCP_UPDATE_COMMAND = 'npx -y @checkbox-site/mcp@latest';

/** Compares dotted versions (1.10.0 > 1.9.0; a pre-release suffix is ignored). Negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split(/[-+]/)[0]!.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const VERSION_RE = /^v?\d+(?:\.\d+){0,3}(?:[-+][\w.]+)?$/;

/** The words an agent reads when this server is older than the API expects; null when it is not (or unknown). */
export function outdatedNotice(current: string, minimum: string | null | undefined): string | null {
  const min = (minimum ?? '').trim();
  if (!min || !VERSION_RE.test(min) || !VERSION_RE.test(current) || compareVersions(current, min) >= 0) return null;
  return `Your Checkbox MCP server is ${current}; the Checkbox API expects ${min} or newer, so arguments and operations its next steps name may be missing here. Ask the human to update it: in the MCP client config run \`${MCP_UPDATE_COMMAND}\` (then restart the client), or connect the remote server https://app.checkbox.site/mcp instead. Until then, call_api reaches any operation.`;
}

/** Remembers the newest minimum version the API sent (headers of any response). */
export class MinimumVersionTracker {
  #minimum: string | undefined;

  get minimum(): string | undefined {
    return this.#minimum;
  }

  /** Reads the header from a fetch Headers object or a plain lower-case record. */
  observe(headers: { get(name: string): string | null } | Record<string, string | undefined> | undefined | null): void {
    if (!headers) return;
    const raw = typeof (headers as { get?: unknown }).get === 'function' ? (headers as { get(name: string): string | null }).get(MCP_MIN_VERSION_HEADER) : (headers as Record<string, string | undefined>)[MCP_MIN_VERSION_HEADER];
    const v = (raw ?? '').trim();
    if (!v || !VERSION_RE.test(v)) return;
    if (!this.#minimum || compareVersions(v, this.#minimum) > 0) this.#minimum = v;
  }
}
