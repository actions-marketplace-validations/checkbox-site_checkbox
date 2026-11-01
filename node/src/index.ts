// Checkbox Node SDK. Public surface:
//   import Checkbox from '@checkbox-site/node';                      // or: import { Checkbox } from '@checkbox-site/node';
//   const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY);
//   await checkbox.checks.stripeCheckoutSession({ params });
//   const event = checkbox.webhooks.constructEvent(rawBody, req.headers['checkbox-signature'], secret);
// Published to npm as @checkbox-site/node.
import { Checkbox } from './client.ts';

export { Checkbox, modeOfKey, getLastResponse, backoff, DEFAULT_BASE_URL, DEFAULT_MAX_NETWORK_RETRIES, DEFAULT_TIMEOUT_MS, type CheckboxConfig, type Mode } from './client.ts';
export {
  CheckboxError,
  CheckboxInvalidRequestError,
  CheckboxAuthenticationError,
  CheckboxPermissionError,
  CheckboxRateLimitError,
  CheckboxIdempotencyError,
  CheckboxAPIError,
  CheckboxConnectionError,
  CheckboxSignatureVerificationError,
  type CheckboxErrorType,
  type CheckboxErrorRaw,
  type NextAction,
} from './errors.ts';
export { Webhooks, webhooks, SIGNATURE_HEADER, DEFAULT_TOLERANCE, parseSignatureHeader, computeSignature, type WebhookPayload, type WebhookHeader, type VerifyOptions } from './webhooks.ts';
export { Resource, MAX_AUTO_PAGING, type ApiListPromise, type ListObject, type RequestOptions, type ResponseMeta } from './resource.ts';
export { OPERATIONS, RESOURCES, type OperationId, type OperationSpec, type OperationTypes } from './generated/operations.ts';
export { SDK_VERSION } from './version.ts';
export * from './generated/types.ts';
export type * as Types from './generated/types.ts';

export default Checkbox;
