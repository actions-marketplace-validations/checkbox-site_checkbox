// The one thing the MCP tools need from the outside world: a way to call the Checkbox /v1 API.
//
// - The remote server (apps/api, https://app.checkbox.site/mcp) implements it in-process with Fastify's inject, so a
//   tool call goes through exactly the same /v1 auth, scopes, test/live mode, idempotency and rate limits as an HTTP
//   call with the same key.
// - The local stdio server (`checkbox-mcp`) implements it over HTTPS (createHttpApi, or an @checkbox-site/node client
//   through fromSdkClient).
import { randomUUID } from 'node:crypto';

/** API version the MCP tools are written against (sent as Checkbox-Version). */
export const API_VERSION = '2026-10-30';
export const DEFAULT_API_BASE = 'https://app.checkbox.site';

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface ApiRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** POST only; a fresh key is generated when omitted, so a transport retry never applies a call twice. */
  idempotencyKey?: string;
  /** Send without the API key (public routes: device login). */
  anonymous?: boolean;
}

/** `next_action` as the API returns it (errors, setup sessions, plans, tasks, checks). */
export interface NextAction {
  type: string;
  message?: string;
  description?: string;
  operation_id?: string | null;
  command?: string | null;
  endpoint?: string | null;
  url?: string | null;
  task?: string | null;
}

/** A non-2xx /v1 response (the error envelope) or a network failure (status 0). */
export class CheckboxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type: string,
    readonly code: string,
    readonly param?: string,
    readonly requestId?: string,
    readonly nextAction?: NextAction,
    readonly docUrl?: string,
  ) {
    super(message);
    this.name = 'CheckboxApiError';
  }
}

export interface CheckboxApi {
  /** Calls `method path` (path starts with /v1/). Resolves with the parsed JSON body; rejects with CheckboxApiError. */
  request<T = unknown>(method: HttpMethod, path: string, opts?: ApiRequestOptions): Promise<T>;
  /** Whether an API key is configured (false: only the device-login setup tools work). */
  readonly hasKey: boolean;
  /** Base URL of the API (for links in tool output). */
  readonly apiBase: string;
}

/** Builds the query string for a request (`expand` arrays are not needed by the tools). */
export function withQuery(path: string, query?: ApiRequestOptions['query']): string {
  const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '');
  if (!entries.length) return path;
  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `${path}${path.includes('?') ? '&' : '?'}${qs.toString()}`;
}

/** Turns a /v1 response (status + parsed body) into a value or a CheckboxApiError. */
export function interpretResponse<T>(status: number, json: unknown, requestId?: string, rawText?: string): T {
  if (status >= 200 && status < 300) return json as T;
  const e = (json as { error?: Record<string, unknown> } | undefined)?.error;
  if (e && typeof e === 'object') {
    return throwError(
      new CheckboxApiError(
        typeof e.message === 'string' ? e.message : `HTTP ${status}`,
        status,
        typeof e.type === 'string' ? e.type : 'api_error',
        typeof e.code === 'string' ? e.code : 'unknown_error',
        typeof e.param === 'string' ? e.param : undefined,
        typeof e.request_id === 'string' ? e.request_id : requestId,
        e.next_action && typeof e.next_action === 'object' ? (e.next_action as NextAction) : undefined,
        typeof e.doc_url === 'string' ? e.doc_url : undefined,
      ),
    );
  }
  return throwError(new CheckboxApiError(`HTTP ${status}: ${(rawText ?? '').slice(0, 200) || 'empty response'}`, status, 'api_error', 'unexpected_response', undefined, requestId));
}

function throwError(err: Error): never {
  throw err;
}

export interface HttpApiOptions {
  apiKey?: string;
  apiBase?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  /** Retries on network errors, 429 and 5xx (default 2). POSTs are safe to retry: they carry an Idempotency-Key. */
  maxRetries?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** /v1 over HTTPS with fetch. Used by the stdio server when no SDK client is supplied. */
export function createHttpApi(opts: HttpApiOptions): CheckboxApi {
  const f = opts.fetch ?? fetch;
  const base = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const maxRetries = opts.maxRetries ?? 2;
  return {
    hasKey: Boolean(opts.apiKey),
    apiBase: base,
    async request<T>(method: HttpMethod, path: string, ro: ApiRequestOptions = {}): Promise<T> {
      const url = base + withQuery(path.startsWith('/') ? path : `/${path}`, ro.query);
      const headers: Record<string, string> = {
        accept: 'application/json',
        'checkbox-version': API_VERSION,
        'user-agent': opts.userAgent ?? 'checkbox-mcp',
      };
      if (opts.apiKey && !ro.anonymous) headers.authorization = `Bearer ${opts.apiKey}`;
      if (ro.body !== undefined) headers['content-type'] = 'application/json';
      if (method === 'POST') headers['idempotency-key'] = ro.idempotencyKey ?? `mcp_${randomUUID()}`;
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await f(url, {
            method,
            headers,
            ...(ro.body !== undefined ? { body: JSON.stringify(ro.body) } : {}),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
          });
        } catch (err) {
          if (attempt < maxRetries) {
            await sleep(300 * 2 ** attempt);
            continue;
          }
          throw new CheckboxApiError(`Could not reach ${base}: ${err instanceof Error ? err.message : String(err)}`, 0, 'api_connection_error', 'network_error');
        }
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 500 * 2 ** attempt);
          continue;
        }
        const text = await res.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        return interpretResponse<T>(res.status, json, res.headers.get('request-id') ?? undefined, text);
      }
    },
  };
}

/**
 * Adapts a Node SDK client (@checkbox-site/node) to CheckboxApi. Any client with a Stripe-style
 * `rawRequest(method, path, params?, options?)` or a `request(method, path, { query, body, idempotencyKey })` works;
 * errors with `status`/`code`/`type` fields are mapped to CheckboxApiError.
 */
export function fromSdkClient(client: unknown, info: { hasKey: boolean; apiBase: string }): CheckboxApi | null {
  const c = client as {
    rawRequest?: (m: string, p: string, params?: unknown, o?: { idempotencyKey?: string; query?: unknown }) => Promise<unknown>;
    request?: (m: string, p: string, o?: { query?: unknown; body?: unknown; idempotencyKey?: string }) => Promise<unknown>;
  };
  const call = c?.request
    ? (m: HttpMethod, p: string, o: ApiRequestOptions) => c.request!(m, p, { query: o.query, body: o.body, idempotencyKey: o.idempotencyKey ?? (m === 'POST' ? `mcp_${randomUUID()}` : undefined) })
    : c?.rawRequest
      ? (m: HttpMethod, p: string, o: ApiRequestOptions) => c.rawRequest!(m, withQuery(p, o.query), o.body, { idempotencyKey: o.idempotencyKey ?? (m === 'POST' ? `mcp_${randomUUID()}` : undefined) })
      : null;
  if (!call) return null;
  return {
    ...info,
    async request<T>(method: HttpMethod, path: string, ro: ApiRequestOptions = {}): Promise<T> {
      try {
        return (await call(method, path, ro)) as T;
      } catch (err) {
        throw toCheckboxApiError(err);
      }
    },
  };
}

function toCheckboxApiError(err: unknown): CheckboxApiError {
  if (err instanceof CheckboxApiError) return err;
  const e = (err ?? {}) as Record<string, unknown>;
  const raw = (e.raw ?? e.error ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 0;
  const next = (e.nextAction ?? e.next_action ?? raw.next_action) as NextAction | undefined;
  return new CheckboxApiError(
    err instanceof Error ? err.message : pick('message') ?? 'Request failed',
    status,
    pick('type') ?? (status ? 'api_error' : 'api_connection_error'),
    pick('code') ?? (status ? 'unknown_error' : 'network_error'),
    pick('param'),
    pick('requestId') ?? pick('request_id'),
    next && typeof next === 'object' ? next : undefined,
    pick('docUrl') ?? pick('doc_url'),
  );
}
