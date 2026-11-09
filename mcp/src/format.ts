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
  createTestCredential: 'store_stripe_test_key',
  createTestRun: 'start_test_run',
  retrieveTestRun: 'get_test_run',
  listTestRuns: 'get_test_run',
  checkDisclosure: 'check_disclosure',
  checkStripeCheckoutSession: 'check_stripe_checkout_session',
  checkEmail: 'check_email',
  checkPage: 'check_page_html',
  checkNoticeSchedule: 'get_notice_schedule',
  listSiteSuggestions: 'suggest_improvements',
  suggestImprovements: 'suggest_improvements',
  listSites: 'list_sites',
  createSite: 'create_site',
  updateSite: 'update_site',
  retrieveSite: 'get_site_status',
  retrieveLatestEvaluation: 'get_site_status',
  createEvaluation: 'verify_site',
  listFindings: 'list_findings',
  retrieveFinding: 'get_finding',
  retrieveFindingFix: 'get_finding',
  publishShopifyTerms: 'publish_shopify_terms',
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
  createReceiptToken: 'POST /v1/receipt_tokens',
  createReceipt: 'POST /v1/receipts',
  retrieveReceiptSettings: 'GET /v1/receipt_settings',
  updateReceiptSettings: 'POST /v1/receipt_settings',
  retrieveDueNotice: 'GET /v1/notices/{notice}',
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

/**
 * Whether the `checkbox` CLI (@checkbox-site/cli) is on npm. While this is false, MCP output never shows `command`
 * fields or a "CLI equivalent". It is published.
 */
export const CLI_PUBLISHED = true;

/** Docs for `checkbox ci` / the GitHub Action (checkbox.json + .github/workflows/checkbox.yml). */
export const CI_DOCS_URL = 'https://checkbox.site/docs/guides/ci';

/**
 * After a check passes, one line offering to keep it passing in CI. The Action runs the published CLI, so this stays
 * off until CLI_PUBLISHED is true (`published` is for tests).
 */
export function ciHint(passing: boolean, published: boolean = CLI_PUBLISHED): string | null {
  if (!published || !passing) return null;
  return `Optional, ask the human once: keep these checks passing on every pull request. With a yes, write checkbox.json listing the files you just checked (Stripe params via "source" or "module", disclosure / email template files, the plans) and .github/workflows/checkbox.yml (uses: checkbox-site/checkbox@v1; offline, no key), then run \`npx @checkbox-site/cli ci\` to confirm. \`npx @checkbox-site/cli ci init --yes\` drafts both. ${CI_DOCS_URL}`;
}

/** REST paths of the preflight checks → their MCP tools (for text written for API users). */
const CHECK_PATH_TOOLS: Record<string, string> = {
  disclosure: 'check_disclosure',
  stripe_checkout_session: 'check_stripe_checkout_session',
  stripe_payment_link: 'call_api (POST /v1/checks/stripe_payment_link)',
  email: 'check_email',
  page: 'check_page_html',
  notice_schedule: 'get_notice_schedule',
};

/** CLI commands → the MCP tool that does the same (for text that still names a command). */
const CLI_TOOLS: Record<string, string> = { plan: 'get_compliance_plan', fix: 'get_task', answer: 'answer_task', verify: 'verify_site', init: 'get_setup_status', check: 'check_disclosure' };

const OP_RE = new RegExp(`\\b(${[...Object.keys(OPERATION_TOOLS), ...Object.keys(OPERATION_ENDPOINTS)].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g');

/**
 * Audit P2: text the API writes for SDK users names operations (verifyTask, updateSite, …) and REST paths. Over MCP
 * those become the tool to call: a dedicated tool name, else `call_api` with the endpoint. CLI hints are dropped while
 * the CLI is unpublished.
 */
export function mcpText(text: string): string {
  // Round 23 (pilot 22 item 9): the REST body `{ type: "stripe_test", secret_key }` is said as the MCP tool's own
  // arguments (store_stripe_test_key takes { secret_key }; `type` is accepted but not needed).
  let s = text.replace(/\{ ?type: ?"stripe_test", ?secret_key\b/g, '{ secret_key');
  s = s.replace(/(?:POST )?\/v1\/checks\/(disclosure|stripe_checkout_session|stripe_payment_link|email|page|notice_schedule)\b/g, (_m, k: string) => CHECK_PATH_TOOLS[k]!);
  s = s.replace(OP_RE, (op: string) => {
    // Round 16 (pilot 15, sveltekit): "verifySetupSession" became plain get_setup_status, which only reads the checklist,
    // so the agent looped on "Snippet installed: pending". The re-check is get_setup_status with verify=true.
    if (op === 'verifySetupSession') return 'get_setup_status (verify=true)';
    const tool = OPERATION_TOOLS[op];
    if (tool) return tool;
    const endpoint = OPERATION_ENDPOINTS[op];
    return endpoint ? `call_api (${endpoint})` : op;
  });
  // Agent audit round 2: "call_api (POST /v1/sites/{site}/notice_settings) (POST /v1/sites/site_…/notice_settings)":
  // an operation followed by its own concrete endpoint is said once, with the concrete path.
  s = s.replace(/call_api \(((?:GET|POST|DELETE) )[^()]*\) \(\1([^()]+)\)/g, (_m, verb: string, path: string) => `call_api (${verb}${path})`);
  if (!CLI_PUBLISHED) {
    s = s
      .replace(/\s*\((?:or )?(?:run )?`(?:npx [^`]*)?checkbox [^`]*`[^)]*\)/g, '')
      .replace(/,? or (?:run )?`checkbox [^`]*`/g, '')
      .replace(/ \(`checkbox [^`]*` (?:writes|does) [^)]*\)/g, '')
      .replace(/(?:run )?`checkbox ([a-z-]+)[^`]*`/g, (_m, cmd: string) => `\`${CLI_TOOLS[cmd] ?? 'get_compliance_plan'}\``);
  }
  return s;
}

const TEXT_KEYS = new Set(['message', 'description', 'summary', 'fix', 'note', 'how', 'detail', 'headline']);
/** Round 21 (pilot 20 item 16): lists of agent-facing sentences the API writes with operation names (REST words). */
const TEXT_LIST_KEYS = new Set(['plan_terms_conflicts', 'notes', 'steps']);

/** Rewrites agent-facing strings in an API object for MCP (mcpText), and drops `command` while the CLI is unpublished. */
export function forMcp(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => forMcp(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'command' && !CLI_PUBLISHED && (v === null || typeof v === 'string')) continue;
    out[k] =
      typeof v === 'string' && TEXT_KEYS.has(k)
        ? mcpText(v)
        : Array.isArray(v) && TEXT_LIST_KEYS.has(k)
          ? v.map((x) => (typeof x === 'string' ? mcpText(x) : forMcp(x, depth + 1)))
          : forMcp(v, depth + 1);
  }
  return out;
}

/** The argument hint for the tool a next step names (the right id for that tool). */
function argHint(tool: string, next: NextAction, ctx: { data?: unknown }): string {
  const d = (ctx.data ?? {}) as { object?: unknown; id?: unknown };
  if (tool === 'get_verification') return d.object === 'verification' && typeof d.id === 'string' ? ` (verification: ${d.id})` : '';
  if (tool === 'get_setup_status' && next.operation_id === 'verifySetupSession') return ' (verify: true)';
  const task = next.task ?? /\/v1\/tasks\/(task_[A-Za-z0-9]+)/.exec(next.endpoint ?? '')?.[1];
  return task && ['get_task', 'verify_task', 'answer_task'].includes(tool) ? ` (task: ${task})` : '';
}

/** One line telling the model what to call next, in MCP terms. */
export function describeNextAction(next: NextAction | null | undefined, ctx: { data?: unknown } = {}): string | null {
  if (!next || typeof next !== 'object' || !next.type) return null;
  const text = mcpText((next.message ?? next.description ?? '').trim());
  if (next.type === 'done' || next.type === 'none') return `Next: nothing left to do${text ? ` — ${text}` : '.'}`;
  // Round 23 (pilot 22, headless-agent-pr): everything left waits for a deploy or the owner.
  if (next.type === 'done_for_now') return `Next: done for this change — ${text || 'the rest waits for a deploy or the owner.'}`;
  const op = next.operation_id ?? undefined;
  // Prefer the API's own mapping (next_action.mcp_tool); `call_api` means "no dedicated tool".
  const named = next.mcp_tool && next.mcp_tool !== 'call_api' ? next.mcp_tool : undefined;
  const tool = named ?? (op ? OPERATION_TOOLS[op] : undefined);
  const parts = [`Next (${next.type}): ${text || 'see next_action.'}`];
  if (tool) parts.push(`→ MCP tool \`${tool}\`${argHint(tool, next, ctx)}.`);
  else if (op) {
    let endpoint = next.endpoint ?? OPERATION_ENDPOINTS[op];
    const site = (ctx.data as { site?: unknown; id?: unknown } | undefined) ?? {};
    const siteId = typeof site.site === 'string' && site.site.startsWith('site_') ? site.site : typeof site.id === 'string' && site.id.startsWith('site_') ? site.id : undefined;
    if (endpoint && siteId) endpoint = endpoint.replace('{site}', siteId);
    parts.push(endpoint ? `→ MCP tool \`call_api\` with ${endpoint}.` : `→ MCP tool \`call_api\` (operation ${op}; paths in /v1/openapi.json).`);
  }
  if (next.command && CLI_PUBLISHED) parts.push(`CLI equivalent: \`${next.command}\`.`);
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

/** The largest array in `data` (top level, or one level down), with its path. */
function largestArray(data: unknown): { path: string[]; items: unknown[] } | null {
  if (!data || typeof data !== 'object') return null;
  let best: { path: string[]; items: unknown[]; size: number } | null = null;
  const consider = (path: string[], v: unknown) => {
    if (!Array.isArray(v) || v.length < 2) return;
    const size = JSON.stringify(v).length;
    if (!best || size > best.size) best = { path, items: v, size };
  };
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    consider([k], v);
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) consider([k, k2], v2);
  }
  return best;
}

function withItems(data: unknown, path: string[], items: unknown[]): unknown {
  const root = { ...(data as Record<string, unknown>) };
  if (path.length === 1) root[path[0]!] = items;
  else root[path[0]!] = { ...(root[path[0]!] as Record<string, unknown>), [path[1]!]: items };
  return root;
}

/** A list this short is never paged down to fewer items: its items' nested lists are shortened instead. */
const SMALL_LIST = 5;

/**
 * Every item of `arr` kept; in each item, its largest nested list (top level or one level down) is cut to the first `k`
 * entries, with `_truncated` saying how many it had. `k` is the largest that fits. Null when even k = 0 does not fit.
 */
function fitNestedLists(data: unknown, arr: { path: string[]; items: unknown[] }, max: number): { json: string; page: string } | null {
  const nested = arr.items.map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? largestArray(item) : null));
  const longest = Math.max(0, ...nested.map((n) => n?.items.length ?? 0));
  if (!longest) return null;
  const render = (k: number) => {
    const items = arr.items.map((item, i) => {
      const n = nested[i];
      if (!n || n.items.length <= k) return item;
      const cut = withItems(item, n.path, n.items.slice(0, k)) as Record<string, unknown>;
      return { ...cut, _truncated: { list: n.path.join('.'), returned: k, total: n.items.length } };
    });
    return JSON.stringify(withItems(data, arr.path, items), null, 2);
  };
  if (render(0).length > max) return null;
  let lo = 0;
  let hi = longest;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (render(mid).length <= max) lo = mid;
    else hi = mid - 1;
  }
  const lists = [...new Set(nested.filter((n): n is NonNullable<typeof n> => !!n && n.items.length > lo).map((n) => n.path.join('.')))];
  return {
    json: render(lo),
    page: `Output shortened: all ${arr.items.length} items of "${arr.path.join('.')}" shown, each with at most ${lo} entries of its "${lists.join('", "')}" list (see _truncated in each item). The JSON is complete and valid; retrieve one item by id to see more of it, or narrow the request.`,
  };
}

/**
 * Round-3 pilot (nextjs, sveltekit): output was cut at 60 KB in the middle of the JSON, which agents then failed to
 * parse. Output is always valid JSON: an oversized list is paged (the first items that fit, plus `_page` naming the
 * ids of the rest to fetch one by one), never cut mid-value.
 */
export function fitJson(data: unknown, max = MAX_JSON_CHARS): { json: string; page?: string } {
  const pretty = JSON.stringify(data, null, 2);
  if (pretty.length <= max) return { json: pretty };
  const arr = largestArray(data);
  if (arr) {
    let lo = 0;
    let hi = arr.items.length;
    const render = (n: number) => {
      const rest = arr.items.slice(n);
      const ids = rest.map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined)).filter((x): x is string => typeof x === 'string');
      return JSON.stringify(withItems({ ...(data as Record<string, unknown>), _page: { list: arr.path.join('.'), returned: n, total: arr.items.length, remaining_ids: ids.slice(0, 200) } }, arr.path, arr.items.slice(0, n)), null, 2);
    };
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (render(mid).length <= max) lo = mid;
      else hi = mid - 1;
    }
    // MCP connector test: list_law_updates (limit 3) printed "0 of 2 items shown": each law update carried hundreds of
    // changed requirements, so not even one item fitted. When paging would drop items of a short list (or all of them),
    // every item is shown instead, with its own longest nested list cut to what fits.
    if (lo < arr.items.length && (lo === 0 || arr.items.length <= SMALL_LIST)) {
      const inner = fitNestedLists(data, arr, max);
      if (inner) return inner;
    }
    const json = render(lo);
    if (json.length <= max) {
      return { json, page: `Output paged: ${lo} of ${arr.items.length} items of "${arr.path.join('.')}" shown. The JSON is complete and valid; fetch the others by id (_page.remaining_ids), e.g. get_task for plan tasks, or narrow the request (a smaller limit).` };
    }
  }
  const compact = JSON.stringify(data);
  if (compact.length <= max) return { json: compact, page: 'Output printed compactly (no indentation) to fit.' };
  return {
    json: JSON.stringify({ _truncated: true, size: compact.length, keys: data && typeof data === 'object' ? Object.keys(data as object) : [] }, null, 2),
    page: `Output too large (${compact.length} characters): narrow the request (a smaller limit, or one item at a time).`,
  };
}

/** The "Next:" line of a result whose API object names no next step. */
export const FALLBACK_NEXT = 'Next: nothing more is needed for this result; get_compliance_plan names the site\'s next step.';
export const FALLBACK_NEXT_ERROR = 'Next: fix what the error names (see the hint above, if any) and call the tool again.';

export function renderOutput(out: ToolOutput): CallToolResult {
  const lines = [mcpText(out.headline.trim())];
  for (const n of out.notes ?? []) if (n) lines.push(`- ${mcpText(n)}`);
  const next = describeNextAction(out.next === undefined ? nextActionOf(out.data) : out.next, { data: out.data });
  // Round 23 (pilot 22 item 27, agent-discovery: a result with no "Next:" line): every result names what comes next.
  lines.push(next ?? (out.isError ? FALLBACK_NEXT_ERROR : FALLBACK_NEXT));
  if (out.data !== undefined) {
    const fitted = fitJson(forMcp(out.data));
    if (fitted.page) lines.push(`- ${fitted.page}`);
    lines.push('', '```json', fitted.json, '```');
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
    const hint = err.code === 'resource_missing' ? missingHint(err.message) : ERROR_HINTS[err.code];
    return renderOutput({
      headline: `Checkbox API error ${err.code}${err.param ? ` (param: ${err.param})` : ''}: ${err.message}`,
      notes: hint ? [hint] : [],
      data: { error: data },
      next: err.nextAction ?? (err.code === 'resource_missing' ? missingNext(err.message) : null),
      isError: true,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return renderOutput({ headline: `Tool failed: ${message}`, isError: true });
}

/** Audit P2: where to find a valid id of the kind that was missing (by its prefix in the message). */
function missingKind(message: string): 'task' | 'site' | 'finding' | 'verification' | 'other' {
  if (/\btask_/.test(message)) return 'task';
  if (/\bver(?:ification)?_/.test(message)) return 'verification';
  if (/\bfinding_/.test(message)) return 'finding';
  if (/\bsite_/.test(message)) return 'site';
  return 'other';
}
function missingHint(message: string): string {
  const where = { task: 'get_compliance_plan lists the current task ids', verification: 'get_task shows a task\'s last_verification id', finding: 'list_findings lists finding ids', site: 'list_sites lists site ids', other: 'get_compliance_plan and list_sites list the current ids' }[missingKind(message)];
  return `The id does not exist in this mode (test keys only see test-mode objects): ${where}.`;
}
function missingNext(message: string): NextAction {
  const k = missingKind(message);
  if (k === 'site') return { type: 'find_id', message: 'Call list_sites for the site ids in this mode.', operation_id: 'listSites' };
  if (k === 'finding') return { type: 'find_id', message: 'Call list_findings for the finding ids.', operation_id: 'listFindings' };
  return { type: 'find_id', message: 'Call get_compliance_plan for the current task ids (each task carries its last_verification id).', operation_id: 'retrieveCompliancePlan' };
}

const ERROR_HINTS: Record<string, string> = {
  insufficient_scope: 'This connection lacks that permission (a read-only connection or a restricted key). Ask the human to reconnect Checkbox and choose Full access on the approval page: Codex: `codex mcp logout checkbox`, then `codex mcp login checkbox`; Claude Code: `/mcp` → checkbox → Clear authentication → Authenticate; claude.ai / Claude Desktop: Settings → Connectors → Checkbox → Disconnect, then Connect. For an API key, change its permissions in the Checkbox dashboard → Agent & API. Never ask them to paste a key. Read-only tools still work.',
  insufficient_role: 'The key acts as a viewer; writes need a member or admin key.',
  api_key_missing: 'No Checkbox API key is configured: call setup_checkbox (one browser approval by the human) to get one.',
  api_key_invalid: 'The configured Checkbox API key is unknown, revoked or expired: reconnect with setup_checkbox (one browser approval by the human), or ask the human to fix the key in the Checkbox dashboard → Developers. Never ask them to paste a key into the chat.',
  account_not_activated: 'Live mode is locked until a site domain is verified. Use a test key (ck_test_…) for setup and checks, or verify the domain first.',
  parameter_invalid: 'Fix the named parameter and call the tool again.',
  parameter_missing: 'Add the named parameter and call the tool again.',
  parameter_unknown: 'Remove the named parameter and call the tool again.',
  rate_limit_exceeded: 'Wait the number of seconds in the message, then retry.',
  shopify_not_connected: 'Only the merchant can connect the store: tell them the step in next_action (install the Checkbox app in the Shopify admin, then "Connect to Checkbox"). Do not retry until they say it is done.',
  terms_incomplete: 'Checkbox never guesses prices or cancellation terms: send the missing plan facts (next_action), then call the tool again.',
  platform_error: 'The merchant\'s platform refused the change; nothing was applied. Retry in a few minutes.',
};
