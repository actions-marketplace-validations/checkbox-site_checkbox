// The Checkbox client: `const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY)`.
// Zero runtime dependencies: global fetch (Node 20+, Bun, Deno, edge runtimes).
import { CheckboxAuthenticationError, CheckboxConnectionError, CheckboxError, CheckboxInvalidRequestError } from './errors.ts';
import * as errors from './errors.ts';
import { OPERATIONS, RESOURCES, type OperationId, type OperationSpec, type OperationTypes } from './generated/operations.ts';
import { API_VERSION, type CheckboxFile } from './generated/types.ts';
import { listPromise, type ApiListPromise, type RequestOptions, type RequestSender, type ResponseMeta } from './resource.ts';
import { SDK_VERSION } from './version.ts';
import { Webhooks, webhooks } from './webhooks.ts';

export const DEFAULT_BASE_URL = 'https://app.checkbox.site';
export const DEFAULT_TIMEOUT_MS = 80_000;
export const DEFAULT_MAX_NETWORK_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 20_000;

export interface CheckboxConfig {
  /** Checkbox-Version to pin (default: the version this SDK was generated for). */
  apiVersion?: string;
  /** API origin (default CHECKBOX_API_BASE or https://app.checkbox.site). */
  baseUrl?: string;
  /** Retries on network errors, 409 idempotency_key_in_use, 429 and 5xx with exponential backoff (default 2). */
  maxNetworkRetries?: number;
  /** Per-attempt timeout in milliseconds (default 80 000). */
  timeout?: number;
  /** fetch implementation (default globalThis.fetch). */
  fetch?: typeof fetch;
  /** Identifies your integration in the User-Agent (e.g. { name: 'checkbox-cli', version: '1.2.0' }). */
  appInfo?: { name: string; version?: string; url?: string };
  /** Headers sent with every request. */
  headers?: Record<string, string>;
}

export type Mode = 'test' | 'live';

/** `ck_test_…` / `rk_test_…` / `pk_test_…` -> test; `ck_live_…` / `rk_live_…` / `sk_live_…` / `pk_live_…` -> live. */
export function modeOfKey(key: string | undefined): Mode | undefined {
  const m = /^(?:ck|rk|sk|pk)_(test|live)_/.exec(key ?? '');
  return m ? (m[1] as Mode) : undefined;
}

type ResourceInstances = { readonly [K in keyof typeof RESOURCES]: InstanceType<(typeof RESOURCES)[K]> };

const env = (name: string): string | undefined => {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.[name] || undefined;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `sdk_${c.randomUUID()}`;
  return `sdk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function runtimeLabel(): string {
  const g = globalThis as { process?: { versions?: { node?: string; bun?: string } }; Deno?: { version?: { deno?: string } } };
  if (g.process?.versions?.bun) return `bun/${g.process.versions.bun}`;
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.node) return `node/${g.process.versions.node}`;
  return 'js';
}

export interface Checkbox extends ResourceInstances {}

/**
 * Checkbox API client.
 *
 * ```ts
 * import Checkbox from '@checkbox-site/node';
 * const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY);
 * const site = await checkbox.sites.create({ url: 'https://acme.example' });
 * for await (const finding of checkbox.findings.list({ site: site.id })) console.log(finding.check_id, finding.status);
 * ```
 */
export class Checkbox implements RequestSender {
  static readonly VERSION = SDK_VERSION;
  static readonly API_VERSION = API_VERSION;
  static readonly errors = errors;
  static readonly webhooks = webhooks;
  static readonly OPERATIONS = OPERATIONS;
  static readonly Webhooks = Webhooks;

  /** Webhook signature verification: `checkbox.webhooks.constructEvent(rawBody, header, secret)`. */
  readonly webhooks: Webhooks = webhooks;
  /** The API version sent as Checkbox-Version. */
  readonly apiVersion: string;
  readonly baseUrl: string;
  /** 'test' for ck_test_/rk_test_ keys, 'live' for live keys, undefined without a (recognised) key. */
  readonly mode: Mode | undefined;
  readonly #apiKey: string | undefined;
  readonly #config: Required<Pick<CheckboxConfig, 'maxNetworkRetries' | 'timeout'>> & CheckboxConfig;
  readonly #userAgent: string;

  /**
   * @param apiKey secret (`ck_test_…`, `ck_live_…`), restricted (`rk_…`) or legacy (`sk_live_…`) key. Defaults to
   *   the CHECKBOX_API_KEY environment variable, then CHECKBOX_SECRET_KEY (what `checkbox init` writes to .env.local).
   */
  constructor(apiKey?: string | null, config: CheckboxConfig = {}) {
    this.#apiKey = (apiKey ?? env('CHECKBOX_API_KEY') ?? env('CHECKBOX_SECRET_KEY'))?.trim() || undefined;
    this.#config = { maxNetworkRetries: DEFAULT_MAX_NETWORK_RETRIES, timeout: DEFAULT_TIMEOUT_MS, ...config };
    this.apiVersion = config.apiVersion ?? API_VERSION;
    this.baseUrl = (config.baseUrl ?? env('CHECKBOX_API_BASE') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.mode = modeOfKey(this.#apiKey);
    const app = config.appInfo ? ` ${config.appInfo.name}${config.appInfo.version ? `/${config.appInfo.version}` : ''}${config.appInfo.url ? ` (${config.appInfo.url})` : ''}` : '';
    this.#userAgent = `checkbox-node/${SDK_VERSION} ${runtimeLabel()}${app}`;
    for (const [ns, Cls] of Object.entries(RESOURCES)) {
      Object.defineProperty(this, ns, { value: new Cls(this), enumerable: true });
    }
  }

  /** True for live keys, false for test keys, undefined when unknown. */
  get livemode(): boolean | undefined {
    return this.mode === undefined ? undefined : this.mode === 'live';
  }

  /** Whether an API key is configured. */
  get hasApiKey(): boolean {
    return this.#apiKey !== undefined;
  }

  /**
   * Calls any operation by its operationId with flat arguments (path parameters and params together). This is the
   * shape MCP tools and agents use: `checkbox.call('retrieveSite', { site: 'site_…' })`.
   */
  call<K extends OperationId>(operationId: K, args?: OperationTypes[K]['args'], options?: RequestOptions): Promise<OperationTypes[K]['response']> {
    const op = OPERATIONS[operationId] as OperationSpec | undefined;
    if (!op) {
      return Promise.reject(
        new CheckboxInvalidRequestError({ message: `Unknown operation "${String(operationId)}".`, type: 'invalid_request_error', code: 'route_not_found', param: 'operationId' }),
      );
    }
    const rest: Record<string, unknown> = { ...((args ?? {}) as Record<string, unknown>) };
    const pathArgs = op.pathParams.map((name) => {
      const v = rest[name];
      delete rest[name];
      return v;
    });
    return this._send(op, pathArgs, rest, options) as Promise<OperationTypes[K]['response']>;
  }

  /** Like `call` for a paginated list operation, returning the auto-paginating list promise. */
  callList<K extends OperationId>(operationId: K, args?: OperationTypes[K]['args'], options?: RequestOptions): ApiListPromise<unknown> {
    const op = OPERATIONS[operationId] as OperationSpec;
    const rest: Record<string, unknown> = { ...((args ?? {}) as Record<string, unknown>) };
    const pathArgs = op.pathParams.map((name) => {
      const v = rest[name];
      delete rest[name];
      return v;
    });
    return listPromise(this, op, pathArgs, rest, options);
  }

  /**
   * Request to any API path with an explicit query and JSON body (escape hatch for endpoints newer than this SDK):
   * `checkbox.request('POST', '/v1/new_thing', { query: { wait: 5 }, body: { a: 1 } })`. Retries, idempotency keys,
   * versioning and typed errors apply as for the generated methods.
   */
  request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: RequestOptions & { query?: Record<string, unknown>; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const { query, body, ...options } = opts;
    return this.#raw(method, path, query ?? {}, body, options) as Promise<T>;
  }

  /**
   * Stripe-style raw request: `params` go to the query string for GET/DELETE and to the JSON body for POST.
   * `checkbox.rawRequest('GET', '/v1/sites', { limit: 3 })`.
   */
  rawRequest<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, unknown>, options: RequestOptions = {}): Promise<T> {
    return (method === 'POST' ? this.#raw(method, path, {}, params ?? {}, options) : this.#raw(method, path, params ?? {}, undefined, options)) as Promise<T>;
  }

  #raw(method: 'GET' | 'POST' | 'DELETE', path: string, query: Record<string, unknown>, body: Record<string, unknown> | undefined, options: RequestOptions): Promise<unknown> {
    const op: OperationSpec = {
      operationId: 'request',
      namespace: 'request',
      method: 'request',
      httpMethod: method,
      path: path.startsWith('/') ? path : `/${path}`,
      pathParams: [],
      queryParams: Object.keys(query),
      body: method === 'POST',
      idempotent: method === 'POST',
      auth: true,
      scope: 'none',
      response: 'json',
      list: false,
      paginated: false,
      summary: '',
    };
    const overlap = Object.keys(query).filter((k) => body && k in body);
    if (overlap.length) {
      return Promise.reject(new CheckboxInvalidRequestError({ message: `"${overlap[0]}" is given both in query and body.`, type: 'invalid_request_error', code: 'parameter_invalid', param: overlap[0] }));
    }
    return this._send(op, [], { ...query, ...(body ?? {}) }, options);
  }

  /** @internal Used by the generated resources. */
  async _send(op: OperationSpec, pathArgs: readonly unknown[], params: Record<string, unknown> | undefined, options: RequestOptions = {}): Promise<unknown> {
    const apiKey = options.apiKey ?? this.#apiKey;
    if (op.auth && !apiKey) {
      throw new CheckboxAuthenticationError({
        message: 'No API key provided. Pass it to new Checkbox(key) or set CHECKBOX_API_KEY (or CHECKBOX_SECRET_KEY, which `checkbox init` writes).',
        type: 'authentication_error',
        code: 'api_key_missing',
        nextAction: {
          type: 'get_api_key',
          message: 'Get a free test key: POST /v1/device/authorize (one browser approval creates an account and test keys), the remote MCP server https://app.checkbox.site/mcp (setup_checkbox), or https://app.checkbox.site/settings/api-keys.',
          url: 'https://app.checkbox.site/settings/api-keys',
        },
      });
    }
    let path = op.path;
    op.pathParams.forEach((name, i) => {
      const v = pathArgs[i];
      if (typeof v !== 'string' || !v.trim()) {
        throw new CheckboxInvalidRequestError({
          message: `Missing required path parameter "${name}" for ${op.operationId}.`,
          type: 'invalid_request_error',
          code: 'parameter_missing',
          param: name,
        });
      }
      path = path.replace(`{${name}}`, encodeURIComponent(v));
    });

    const url = new URL(this.baseUrl + path);
    const queryNames = new Set(op.queryParams);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined) continue;
      const inQuery = op.httpMethod !== 'POST' || queryNames.has(k) || (k === 'expand' && queryNames.has('expand[]'));
      if (!inQuery) {
        body[k] = v;
        continue;
      }
      if (k === 'expand' || k === 'expand[]') {
        for (const e of Array.isArray(v) ? v : [v]) url.searchParams.append('expand[]', String(e));
      } else if (Array.isArray(v)) {
        for (const e of v) url.searchParams.append(`${k}[]`, String(e));
      } else if (v !== null && typeof v === 'object') {
        url.searchParams.set(k, JSON.stringify(v));
      } else {
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      accept: op.response === 'json' ? 'application/json' : '*/*',
      'checkbox-version': options.apiVersion ?? this.apiVersion,
      'user-agent': this.#userAgent,
      ...(this.#config.headers ?? {}),
      ...(options.headers ?? {}),
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    let payload: string | undefined;
    if (op.httpMethod === 'POST') {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
      if (op.idempotent || options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey ?? newIdempotencyKey();
    }

    const maxRetries = Math.max(0, options.maxNetworkRetries ?? this.#config.maxNetworkRetries);
    const timeout = options.timeout ?? this.#config.timeout;
    const f = this.#config.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') throw new Error('No fetch implementation: use Node 20+ or pass { fetch } to new Checkbox().');

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      const signals = [AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])];
      try {
        res = await f(url, {
          method: op.httpMethod,
          headers,
          ...(payload !== undefined ? { body: payload } : {}),
          signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]!,
        });
      } catch (err) {
        if (options.signal?.aborted) throw err;
        if (attempt < maxRetries) {
          await sleep(backoff(attempt), options.signal);
          continue;
        }
        const timedOut = (err as { name?: string })?.name === 'TimeoutError';
        throw new CheckboxConnectionError({
          message: timedOut
            ? `Request to ${url.origin} timed out after ${timeout} ms (${attempt + 1} attempt${attempt ? 's' : ''}).`
            : `Could not reach ${url.origin}: ${(err as Error)?.message ?? String(err)} (${attempt + 1} attempt${attempt ? 's' : ''}).`,
          type: 'connection_error',
          code: timedOut ? 'timeout' : 'connection_failed',
          nextAction: { type: 'retry', message: 'Check the network and CHECKBOX_API_BASE, then retry; POSTs are safe to retry with the same idempotencyKey.' },
          cause: err,
        });
      }
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (resHeaders[k.toLowerCase()] = v));

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        const error = CheckboxError.generate(res.status, json ?? (text ? { error: text.slice(0, 300) } : undefined), resHeaders);
        if (attempt < maxRetries && shouldRetry(res.status, error.code)) {
          await sleep(retryDelay(attempt, resHeaders['retry-after']), options.signal);
          continue;
        }
        throw error;
      }

      const meta: ResponseMeta = {
        statusCode: res.status,
        requestId: resHeaders['request-id'],
        apiVersion: resHeaders['checkbox-version'],
        idempotencyKey: headers['idempotency-key'],
        idempotentReplayed: resHeaders['idempotent-replayed'] === 'true',
        headers: resHeaders,
      };
      if (op.response === 'binary') {
        const data = new Uint8Array(await res.arrayBuffer());
        const disposition = resHeaders['content-disposition'] ?? '';
        const file: CheckboxFile = { data, contentType: resHeaders['content-type'] ?? null, filename: /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null };
        return withMeta(file, meta);
      }
      const text = await res.text();
      if (op.response === 'text') return text;
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new CheckboxError({ message: `Invalid JSON from the API (HTTP ${res.status}).`, type: 'api_error', code: 'invalid_response', statusCode: res.status, requestId: meta.requestId, headers: resHeaders });
      }
      return withMeta(json, meta);
    }
  }
}

function withMeta<T>(value: T, meta: ResponseMeta): T {
  if (value && typeof value === 'object' && Object.isExtensible(value)) {
    Object.defineProperty(value, 'lastResponse', { value: meta, enumerable: false, configurable: true });
  }
  return value;
}

/** Response metadata of an object returned by the SDK (status, request id, idempotency replay, headers). */
export function getLastResponse(obj: unknown): ResponseMeta | undefined {
  return obj && typeof obj === 'object' ? ((obj as { lastResponse?: ResponseMeta }).lastResponse ?? undefined) : undefined;
}

function shouldRetry(status: number, code: string | undefined): boolean {
  return status === 429 || status >= 500 || (status === 409 && code === 'idempotency_key_in_use');
}

/** 0.5 s, 1 s, 2 s, ... capped at 20 s, with jitter (75-100 %). */
export function backoff(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.round(base * (0.75 + Math.random() * 0.25));
}

function retryDelay(attempt: number, retryAfter: string | undefined): number {
  const s = Number(retryAfter);
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, MAX_RETRY_DELAY_MS);
  return backoff(attempt);
}
