// Webhook signature verification. Checkbox signs every delivery with
//   Checkbox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(endpoint secret, "<t>.<raw body>")>
// (several v1 entries during a secret roll). Verify against the RAW request body: re-serialised JSON will not match.
import { createHmac } from 'node:crypto';
import { CheckboxSignatureVerificationError } from './errors.ts';
import type { WebhookEvent } from './generated/types.ts';

export const SIGNATURE_HEADER = 'Checkbox-Signature';
/** Default maximum age of a signature, in seconds (replay protection). */
export const DEFAULT_TOLERANCE = 300;

export type WebhookPayload = string | Uint8Array;
export type WebhookHeader = string | string[] | undefined | null;

const decoder = new TextDecoder();

function payloadText(payload: WebhookPayload): string {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Uint8Array) return decoder.decode(payload);
  throw new CheckboxSignatureVerificationError(
    'Webhook payload must be the raw request body as a string or Buffer (not parsed JSON). In Express use express.raw({ type: "application/json" }); in Next.js use await request.text().',
    undefined,
    String(payload),
  );
}

function headerText(header: WebhookHeader): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header ?? undefined;
}

export interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(header: string | undefined): ParsedSignatureHeader | null {
  if (!header || header.length > 2000) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
  }
  return timestamp === null || !signatures.length ? null : { timestamp, signatures };
}

export function computeSignature(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

export interface VerifyOptions {
  /** Maximum signature age in seconds (default 300). 0 disables the check (not recommended). */
  tolerance?: number;
  /** Current time in unix seconds (tests). */
  now?: number;
}

/** Constant-time comparison of two hex strings (no Buffer, so it also runs on edge runtimes). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function check(payload: string, header: string | undefined, secret: string, opts: VerifyOptions, hmac: (t: number) => string): void {
  if (!secret) throw new CheckboxSignatureVerificationError('No webhook secret given. Use the endpoint secret (whsec_…) from createWebhookEndpoint.', header, payload);
  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    throw new CheckboxSignatureVerificationError(
      `Missing or malformed ${SIGNATURE_HEADER} header (expected "t=<timestamp>,v1=<signature>").`,
      header,
      payload,
    );
  }
  const expected = hmac(parsed.timestamp);
  const match = parsed.signatures.some((s) => safeEqual(s, expected));
  if (!match) {
    throw new CheckboxSignatureVerificationError(
      'No signature matches the payload. Check that you pass the raw request body (not parsed JSON) and the secret of this endpoint.',
      header,
      payload,
    );
  }
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - parsed.timestamp) > tolerance) {
    throw new CheckboxSignatureVerificationError(`Signature timestamp is outside the tolerance of ${tolerance} seconds (possible replay).`, header, payload);
  }
}

function parseEvent(text: string, header: string | undefined): WebhookEvent {
  try {
    return JSON.parse(text) as WebhookEvent;
  } catch {
    throw new CheckboxSignatureVerificationError('The payload is not valid JSON.', header, text);
  }
}

export class Webhooks {
  /**
   * Verifies `Checkbox-Signature` and returns the parsed event. Throws CheckboxSignatureVerificationError when the
   * signature does not match or is older than `tolerance` seconds.
   *
   * @param payload the RAW request body (string or Buffer)
   * @param header the Checkbox-Signature header
   * @param secret the endpoint secret (whsec_…)
   */
  constructEvent(payload: WebhookPayload, header: WebhookHeader, secret: string, tolerance?: number | VerifyOptions): WebhookEvent {
    const text = payloadText(payload);
    const h = headerText(header);
    const opts = typeof tolerance === 'number' ? { tolerance } : (tolerance ?? {});
    check(text, h, secret, opts, (t) => computeSignature(text, secret, t));
    return parseEvent(text, h);
  }

  /** Same as constructEvent, using WebCrypto (edge runtimes: Vercel Edge, Cloudflare Workers, Deno). */
  async constructEventAsync(payload: WebhookPayload, header: WebhookHeader, secret: string, tolerance?: number | VerifyOptions): Promise<WebhookEvent> {
    const text = payloadText(payload);
    const h = headerText(header);
    const opts = typeof tolerance === 'number' ? { tolerance } : (tolerance ?? {});
    const parsed = parseSignatureHeader(h);
    let hex = '';
    if (parsed && secret) {
      const enc = new TextEncoder();
      const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(`${parsed.timestamp}.${text}`)));
      hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    check(text, h, secret, opts, () => hex);
    return parseEvent(text, h);
  }

  /** True when the signature is valid (no exception). */
  verifySignature(payload: WebhookPayload, header: WebhookHeader, secret: string, opts: VerifyOptions = {}): boolean {
    try {
      const text = payloadText(payload);
      check(text, headerText(header), secret, opts, (t) => computeSignature(text, secret, t));
      return true;
    } catch (err) {
      if (err instanceof CheckboxSignatureVerificationError) return false;
      throw err;
    }
  }

  /** Builds a valid Checkbox-Signature header for a payload (for your tests). */
  generateTestHeaderString(opts: { payload: string; secret: string; timestamp?: number }): string {
    const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
    return `t=${t},v1=${computeSignature(opts.payload, opts.secret, t)}`;
  }
}

export const webhooks = new Webhooks();
