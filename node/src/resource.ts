// Base class of the generated resource namespaces, request options and the auto-paginating list promise.
import type { OperationSpec } from './generated/operations.ts';

/** Per-request options (last argument of every method). */
export interface RequestOptions {
  /** Idempotency-Key for this POST. Generated automatically (and reused across retries) when omitted. */
  idempotencyKey?: string;
  /** Checkbox-Version for this request (defaults to the client's). */
  apiVersion?: string;
  /** Use another API key for this request (e.g. a live key next to a test-mode client). */
  apiKey?: string;
  /** Timeout in milliseconds for each attempt (defaults to the client's, 80 s). */
  timeout?: number;
  /** Retries on network errors, 409 idempotency_key_in_use, 429 and 5xx (defaults to the client's, 2). */
  maxNetworkRetries?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Abort the request (and its retries). */
  signal?: AbortSignal;
}

/** A page of a list (`{ object: 'list', data, has_more, url }`). */
export interface ListObject<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/**
 * Result of a paginated `list()`: await it for one page, or iterate it with `for await` to walk every object across
 * pages (cursor pagination with `starting_after`, or `ending_before` when you started with it).
 */
export interface ApiListPromise<T> extends Promise<ListObject<T>>, AsyncIterable<T> {
  /** Calls `fn` for every object across pages; return `false` from `fn` to stop early. */
  autoPagingEach(fn: (item: T) => void | boolean | Promise<void | boolean>): Promise<void>;
  /** Collects objects across pages, at most `limit` (required; max 10 000). */
  autoPagingToArray(opts: { limit: number }): Promise<T[]>;
}

/** Response metadata, attached (non-enumerable) to every returned object as `lastResponse`. */
export interface ResponseMeta {
  statusCode: number;
  requestId: string | undefined;
  apiVersion: string | undefined;
  idempotencyKey: string | undefined;
  /** True when the response replayed an earlier request with the same Idempotency-Key. */
  idempotentReplayed: boolean;
  headers: Record<string, string>;
}

/** What a resource needs from the client. */
export interface RequestSender {
  _send(op: OperationSpec, pathArgs: readonly unknown[], params: Record<string, unknown> | undefined, options: RequestOptions | undefined): Promise<unknown>;
}

export abstract class Resource {
  constructor(protected readonly _client: RequestSender) {}

  protected _request(op: OperationSpec, pathArgs: readonly unknown[], params: object | undefined, options: RequestOptions | undefined): Promise<unknown> {
    return this._client._send(op, pathArgs, params as Record<string, unknown> | undefined, options);
  }

  protected _list<T>(op: OperationSpec, pathArgs: readonly unknown[], params: object | undefined, options: RequestOptions | undefined): ApiListPromise<T> {
    return listPromise<T>(this._client, op, pathArgs, (params ?? {}) as Record<string, unknown>, options);
  }
}

export const MAX_AUTO_PAGING = 10_000;

export function listPromise<T>(
  client: RequestSender,
  op: OperationSpec,
  pathArgs: readonly unknown[],
  params: Record<string, unknown>,
  options: RequestOptions | undefined,
): ApiListPromise<T> {
  const fetchPage = (p: Record<string, unknown>) => client._send(op, pathArgs, p, options) as Promise<ListObject<T>>;
  const first = fetchPage(params);
  const backwards = params.ending_before !== undefined && params.starting_after === undefined;

  async function* iterate(): AsyncGenerator<T> {
    let page = await first;
    for (;;) {
      const items = backwards ? [...page.data].reverse() : page.data;
      for (const item of items) yield item;
      if (!page.has_more || !page.data.length) return;
      const cursor = (backwards ? page.data[0] : page.data[page.data.length - 1]) as { id?: unknown } | undefined;
      if (typeof cursor?.id !== 'string') return;
      const { starting_after: _s, ending_before: _e, ...rest } = params;
      page = await fetchPage(backwards ? { ...rest, ending_before: cursor.id } : { ...rest, starting_after: cursor.id });
    }
  }

  const promise = first as ApiListPromise<T>;
  // Keep `then` on the original promise; add the iteration helpers.
  Object.defineProperties(promise, {
    [Symbol.asyncIterator]: { value: () => iterate(), enumerable: false },
    autoPagingEach: {
      enumerable: false,
      value: async (fn: (item: T) => void | boolean | Promise<void | boolean>) => {
        for await (const item of iterate()) if ((await fn(item)) === false) return;
      },
    },
    autoPagingToArray: {
      enumerable: false,
      value: async (opts: { limit: number }) => {
        const limit = opts?.limit;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUTO_PAGING) {
          throw new RangeError(`autoPagingToArray needs { limit } between 1 and ${MAX_AUTO_PAGING}.`);
        }
        const out: T[] = [];
        for await (const item of iterate()) {
          out.push(item);
          if (out.length >= limit) break;
        }
        return out;
      },
    },
  });
  return promise;
}
