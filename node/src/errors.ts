// Typed errors (Stripe-style). Every API error carries the stable `code`, the `type`, the HTTP status, the request id and,
// for agents, `nextAction`: what to call or change next.

/** `next_action` of an error or object: what an agent should do next. */
export interface NextAction {
  /** Stable machine-readable action type, e.g. "verify_domain", "create_site", "wait". */
  type: string;
  /** One or two sentences for the agent or human. */
  message: string;
  /** API operation to call next (also the SDK method's operationId; `mcp_tool` names the MCP tool). */
  operation_id?: string;
  /** Page or document to open. */
  url?: string;
  [key: string]: unknown;
}

export type CheckboxErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'rate_limit_error'
  | 'idempotency_error'
  | 'api_error'
  | 'connection_error'
  | 'signature_verification_error';

export interface CheckboxErrorRaw {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
  doc_url?: string;
  request_id?: string;
  next_action?: NextAction;
  [key: string]: unknown;
}

export interface CheckboxErrorInit {
  message: string;
  type: CheckboxErrorType;
  code?: string | undefined;
  param?: string | undefined;
  statusCode?: number | undefined;
  requestId?: string | undefined;
  docUrl?: string | undefined;
  nextAction?: NextAction | undefined;
  headers?: Record<string, string> | undefined;
  raw?: CheckboxErrorRaw | undefined;
  cause?: unknown;
}

/** Base class of every error the SDK throws. Branch on `code` (stable) rather than on `message`. */
export class CheckboxError extends Error {
  /** Error category (`invalid_request_error`, `authentication_error`, ...). */
  readonly type: CheckboxErrorType;
  /** Stable machine-readable code (`resource_missing`, `parameter_invalid`, ...); see ERROR_CODES. */
  readonly code: string | undefined;
  /** The parameter the error is about, when there is one. */
  readonly param: string | undefined;
  /** HTTP status (undefined for connection and signature errors). */
  readonly statusCode: number | undefined;
  /** `req_…` id; quote it to support. */
  readonly requestId: string | undefined;
  /** Documentation of the error code. */
  readonly docUrl: string | undefined;
  /** What an agent should do next (call an operation, open a URL, ask the human). */
  readonly nextAction: NextAction | undefined;
  /** Response headers (lower-case names). */
  readonly headers: Record<string, string>;
  /** The `error` object of the response body. */
  readonly raw: CheckboxErrorRaw | undefined;

  constructor(init: CheckboxErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.type = init.type;
    this.code = init.code;
    this.param = init.param;
    this.statusCode = init.statusCode;
    this.requestId = init.requestId;
    this.docUrl = init.docUrl;
    this.nextAction = init.nextAction;
    this.headers = init.headers ?? {};
    this.raw = init.raw;
  }

  /** A JSON-friendly view (what an agent should log or show). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      code: this.code,
      message: this.message,
      param: this.param,
      status: this.statusCode,
      request_id: this.requestId,
      doc_url: this.docUrl,
      next_action: this.nextAction,
    };
  }

  /** Builds the right subclass from an HTTP status and the response body's `error` object. */
  static generate(statusCode: number, body: unknown, headers: Record<string, string> = {}): CheckboxError {
    const e = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    const raw: CheckboxErrorRaw | undefined = e && typeof e === 'object' ? (e as CheckboxErrorRaw) : undefined;
    const message =
      raw?.message ?? (typeof e === 'string' ? e : `Checkbox API returned HTTP ${statusCode}${statusCode === 404 ? ' (no such endpoint)' : ''}.`);
    const type = (raw?.type as CheckboxErrorType | undefined) ?? typeForStatus(statusCode);
    const init: CheckboxErrorInit = {
      message,
      type,
      code: raw?.code,
      param: raw?.param,
      statusCode,
      requestId: raw?.request_id ?? headers['request-id'],
      docUrl: raw?.doc_url,
      nextAction: raw?.next_action && typeof raw.next_action === 'object' ? raw.next_action : undefined,
      headers,
      raw,
    };
    switch (type) {
      case 'authentication_error':
        return new CheckboxAuthenticationError(init);
      case 'permission_error':
        return new CheckboxPermissionError(init);
      case 'rate_limit_error':
        return new CheckboxRateLimitError(init);
      case 'idempotency_error':
        return new CheckboxIdempotencyError(init);
      case 'invalid_request_error':
        return new CheckboxInvalidRequestError(init);
      default:
        return new CheckboxAPIError(init);
    }
  }
}

function typeForStatus(status: number): CheckboxErrorType {
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 400 && status < 500) return 'invalid_request_error';
  return 'api_error';
}

/** Bad parameters, unknown object (`resource_missing`), wrong state (`resource_conflict`), ... (HTTP 400/404/409/410). */
export class CheckboxInvalidRequestError extends CheckboxError {}
/** Missing, unknown or revoked API key (HTTP 401). */
export class CheckboxAuthenticationError extends CheckboxError {}
/** The key may not do this: publishable key, missing scope or role, live mode not activated (HTTP 403). */
export class CheckboxPermissionError extends CheckboxError {}
/** Too many requests (HTTP 429); retried automatically, thrown when retries are exhausted. */
export class CheckboxRateLimitError extends CheckboxError {}
/** An Idempotency-Key was reused with a different body, or is still in use. */
export class CheckboxIdempotencyError extends CheckboxError {}
/** Something went wrong on Checkbox's side (HTTP 5xx); retrying with the same Idempotency-Key is safe. */
export class CheckboxAPIError extends CheckboxError {}
/** The API could not be reached (DNS, TLS, timeout, connection reset) after the retries. */
export class CheckboxConnectionError extends CheckboxError {}
/** A webhook's Checkbox-Signature did not match the payload and secret, or was too old. */
export class CheckboxSignatureVerificationError extends CheckboxError {
  readonly header: string | undefined;
  readonly payload: string;
  constructor(message: string, header: string | undefined, payload: string) {
    super({ message, type: 'signature_verification_error', code: 'signature_verification_failed' });
    this.header = header;
    this.payload = payload;
  }
}
