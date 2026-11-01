// Tool output for an LLM: one short headline, the next step translated into an MCP tool call, then the API object as
// JSON. Errors are tool results with isError (not protocol errors) so the model can read the stable code and recover.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CheckboxApiError, type NextAction } from './api.ts';

/** API operationId → the MCP tool that performs it. Operations without a tool are reached with call_api. */
export const OPERATION_TOOLS: Record<string, string> = {
  createDeviceAuthorization: 'setup_checkbox',
  createDeviceToken: 'setup_checkbox',
  createSetupSession: 'setup_checkbox',
  retrieveSetupSession: 'get_setup_status',
  listSetupSessions: 'get_setup_status',
  verifySetupSession: 'get_setup_status',
  updateSetupSession: 'update_setup',
  completeSetupSession: 'complete_setup',
  retrieveCompliancePlan: 'get_compliance_plan',
  retrieveTask: 'get_task',
  verifyTask: 'verify_task',
  answerTask: 'answer_task',
  verifySite: 'verify_site',
  retrieveVerification: 'get_verification',
  createTestRun: 'start_test_run',
  retrieveTestRun: 'get_test_run',
  listTestRuns: 'get_test_run',
  checkDisclosure: 'check_disclosure',
  checkStripeCheckoutSession: 'check_stripe_checkout_session',
  checkEmail: 'check_email',
  checkPage: 'check_page_html',
  checkNoticeSchedule: 'get_notice_schedule',
  listSites: 'list_sites',
  createSite: 'create_site',
  updateSite: 'update_site',
  retrieveSite: 'get_site_status',
  retrieveLatestEvaluation: 'get_site_status',
  createEvaluation: 'verify_site',
  listFindings: 'list_findings',
  retrieveFinding: 'get_finding',
  retrieveFindingFix: 'get_finding',
  createScan: 'run_scan',
  retrieveScan: 'get_scan',
  listLawUpdates: 'list_law_updates',
  createFeedback: 'send_feedback',
  createDisclosure: 'get_elements_snippet',
  retrieveReceipt: 'get_receipt',
  verifyReceipt: 'get_receipt',
  listReceipts: 'list_receipts',
  listDueNotices: 'list_due_notices',
  markNoticeSent: 'mark_notice_sent',
  markNoticeMissed: 'mark_notice_sent',
  listNoticeTemplates: 'get_notice_templates',
  checkNoticeTemplate: 'get_notice_templates',
};


/** The MCP tool that performs an operation: its dedicated tool, else `call_api`. */
export function mcpToolFor(operationId: string | null | undefined): string | null {
  if (!operationId) return null;
  return OPERATION_TOOLS[operationId] ?? 'call_api';
}

/** Arguments for the generic call_api tool when an operation has no dedicated tool. */
const OPERATION_ENDPOINTS: Record<string, string> = {
  createTestCredential: 'POST /v1/sites/{site}/test_credentials',
  connectBillingPlatform: 'POST /v1/sites/{site}/integrations',
  createStripeCheckoutConfig: 'POST /v1/sites/{site}/stripe_checkout_configs',
  createDomainVerification: 'POST /v1/sites/{site}/domain_verification',
  checkDomainVerification: 'POST /v1/sites/{site}/domain_verification/check',
  retrieveDomainVerification: 'GET /v1/sites/{site}/domain_verification',
  updateTask: 'POST /v1/tasks/{task}',
  updateFinding: 'POST /v1/findings/{finding}',
  listConsents: 'GET /v1/consents',
  updateNoticeSettings: 'POST /v1/sites/{site}/notice_settings',
  retrieveNoticeSettings: 'GET /v1/sites/{site}/notice_settings',
  createWebhookEndpoint: 'POST /v1/webhook_endpoints',
  createCertificate: 'POST /v1/sites/{site}/certificates',
  retrieveAccount: 'GET /v1/account',
  checkStripePaymentLink: 'POST /v1/checks/stripe_payment_link',
  listSiteFixes: 'GET /v1/sites/{site}/fixes',
  listVerifications: 'GET /v1/sites/{site}/verifications',
  cancelTestRun: 'POST /v1/test_runs/{test_run}/cancel',
};

/**
 * Quotes text Checkbox did not write (page HTML, email bodies, policy text, merchant-supplied strings) for the text part
 * of a tool result: JSON-encoded on one line, truncated, inside explicit <untrusted_text> delimiters, so a model never
 * reads it as an instruction next to the "Next:" line. Full values stay in the fenced JSON.
 */
export function untrusted(value: unknown, max = 80): string {
  let s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max)}…`;
  // No markup that could close the delimiter or open a fake one.
  s = s.replace(/</g, '‹').replace(/>/g, '›');
  return `<untrusted_text>${JSON.stringify(s)}</untrusted_text>`;
}

/** One line telling the model what to call next, in MCP terms. */
export function describeNextAction(next: NextAction | null | undefined): string | null {
  if (!next || typeof next !== 'object' || !next.type) return null;
  const text = (next.message ?? next.description ?? '').trim();
  if (next.type === 'done' || next.type === 'none') return `Next: nothing left to do${text ? ` — ${text}` : '.'}`;
  const op = next.operation_id ?? undefined;
  const tool = op ? OPERATION_TOOLS[op] : undefined;
  const parts = [`Next (${next.type}): ${text || 'see next_action.'}`];
  if (tool) parts.push(`→ MCP tool \`${tool}\`${next.task ? ` (task: ${next.task})` : ''}.`);
  else if (op) {
    const endpoint = next.endpoint ?? OPERATION_ENDPOINTS[op];
    parts.push(endpoint ? `→ MCP tool \`call_api\` with ${endpoint} (operation ${op}).` : `→ operation ${op} (use \`call_api\`; paths in /v1/openapi.json).`);
  }
  if (next.command) parts.push(`CLI equivalent: \`${next.command}\`.`);
  if (next.url && !tool) parts.push(`Docs: ${next.url}`);
  return parts.join(' ');
}

/** Pulls the top-level next_action off an API object. */
export function nextActionOf(obj: unknown): NextAction | null {
  const n = (obj as { next_action?: unknown } | null)?.next_action;
  return n && typeof n === 'object' ? (n as NextAction) : null;
}

export interface ToolOutput {
  /** One or two sentences: what happened / where things stand. */
  headline: string;
  /** Extra lines (bullets) between the headline and the JSON. */
  notes?: string[];
  /** The API object (or a composite). Printed as JSON. */
  data?: unknown;
  /** Overrides data.next_action for the "Next:" line. */
  next?: NextAction | null;
  /** Mark the result as an error the model should act on (still a normal result). */
  isError?: boolean;
}

const MAX_JSON_CHARS = 60_000;

export function renderOutput(out: ToolOutput): CallToolResult {
  const lines = [out.headline.trim()];
  for (const n of out.notes ?? []) if (n) lines.push(`- ${n}`);
  const next = describeNextAction(out.next === undefined ? nextActionOf(out.data) : out.next);
  if (next) lines.push(next);
  if (out.data !== undefined) {
    let json = JSON.stringify(out.data, null, 2);
    if (json.length > MAX_JSON_CHARS) {
      json = `${json.slice(0, MAX_JSON_CHARS)}\n… (truncated ${json.length - MAX_JSON_CHARS} characters; narrow the request, e.g. a smaller limit or one task at a time)`;
    }
    lines.push('', '```json', json, '```');
  }
  return { content: [{ type: 'text', text: lines.join('\n') }], ...(out.isError ? { isError: true } : {}) };
}

/** An API error as a tool result: stable code, message, param and the API's own next_action. */
export function renderError(err: unknown): CallToolResult {
  if (err instanceof CheckboxApiError) {
    const data: Record<string, unknown> = { type: err.type, code: err.code, message: err.message };
    if (err.param) data.param = err.param;
    if (err.status) data.http_status = err.status;
    if (err.requestId) data.request_id = err.requestId;
    if (err.docUrl) data.doc_url = err.docUrl;
    if (err.nextAction) data.next_action = err.nextAction;
    const hint = ERROR_HINTS[err.code];
    return renderOutput({
      headline: `Checkbox API error ${err.code}${err.param ? ` (param: ${err.param})` : ''}: ${err.message}`,
      notes: hint ? [hint] : [],
      data: { error: data },
      next: err.nextAction ?? null,
      isError: true,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return renderOutput({ headline: `Tool failed: ${message}`, isError: true });
}

const ERROR_HINTS: Record<string, string> = {
  insufficient_scope: 'The API key this MCP server uses is a restricted key without that permission. Ask the human for a key with the permission (Dashboard → Developers → API keys) or use a read-only tool.',
  insufficient_role: 'The key acts as a viewer; writes need a member or admin key.',
  api_key_missing: 'No Checkbox API key is configured: call setup_checkbox (one browser approval by the human) to get one.',
  api_key_invalid: 'The configured Checkbox API key is unknown, revoked or expired: call setup_checkbox to get a new one, or ask the human for a valid key.',
  account_not_activated: 'Live mode is locked until a site domain is verified. Use a test key (ck_test_…) for setup and checks, or verify the domain first.',
  parameter_invalid: 'Fix the named parameter and call the tool again.',
  parameter_missing: 'Add the named parameter and call the tool again.',
  parameter_unknown: 'Remove the named parameter and call the tool again.',
  resource_missing: 'The id does not exist in this mode (test keys only see test-mode objects). Use list_sites / list_findings to find valid ids.',
  rate_limit_exceeded: 'Wait the number of seconds in the message, then retry.',
};
