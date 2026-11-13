// Round 39 (founder: "very usable and fast"; testers: ~15 KB per setup / plan / verify result, the same checklist and
// next_action printed up to three times). The default result of every tool is a short text summary plus a compact JSON
// with only what an agent acts on: ids, statuses, the one next_action (as a tool call), owner questions once, open task
// ids and titles. `verbose: true` returns the API's full object. Everything here is pure.
import type { NextAction } from './api.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** At most `max` characters, cut at a word, with an ellipsis. */
export function clip(v: unknown, max: number): string | undefined {
  const s = str(v)?.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

/** Drops undefined, null, empty arrays and empty objects (compact output only says what is there). */
function prune<T extends Obj>(o: T): T {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (isObj(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out as T;
}

const ID = (prefix: string) => new RegExp(`\\b(${prefix}_[A-Za-z0-9]+)\\b`);

/**
 * The MCP tool call a next step names: the tool and its arguments (the right ids for that tool), so an agent can call it
 * without reading anything else. Null when the step is not a tool call (done, wait for the human).
 */
export function nextToolCall(next: NextAction | null | undefined, data?: unknown, opTools: Record<string, string> = {}): { tool: string; args: Obj } | null {
  if (!next || typeof next !== 'object' || !next.type) return null;
  if (next.type === 'done' || next.type === 'none' || next.type === 'done_for_now') return null;
  const op = next.operation_id ?? undefined;
  const tool = (next.mcp_tool && next.mcp_tool !== 'call_api' ? next.mcp_tool : undefined) ?? (op ? opTools[op] : undefined) ?? (op || next.endpoint ? 'call_api' : undefined);
  if (!tool) return null;
  const endpoint = str(next.endpoint) ?? '';
  const d = isObj(data) ? data : {};
  const site = ID('site').exec(endpoint)?.[1];
  const args: Obj = {};
  switch (tool) {
    case 'get_task':
    case 'verify_task':
    case 'answer_task': {
      const task = next.task ?? ID('task').exec(endpoint)?.[1];
      if (task) args.task = task;
      break;
    }
    case 'get_verification': {
      const ver = ID('ver').exec(endpoint)?.[1] ?? (d.object === 'verification' ? str(d.id) : undefined);
      if (ver) args.verification = ver;
      if (/[?&]wait=/.test(endpoint)) args.wait = 30;
      break;
    }
    case 'get_test_run': {
      const run = ID('run').exec(endpoint)?.[1] ?? (d.object === 'test_run' ? str(d.id) : undefined);
      if (run) args.test_run = run;
      if (next.type === 'wait' || next.type === 'wait_for_test_run') args.wait = 55;
      break;
    }
    case 'get_setup_status':
      if (op === 'verifySetupSession') args.verify = true;
      break;
    case 'store_stripe_test_key':
      if (site) args.site = site;
      args.secret_key = 'rk_test_… (from the project env)';
      break;
    case 'get_compliance_plan':
    case 'start_test_run':
    case 'verify_site':
    case 'get_site_status':
      if (site) args.site = site;
      break;
    case 'call_api': {
      const m = /^(GET|POST|DELETE)\s+(\S+)/.exec(endpoint);
      if (m && !/[{}]/.test(m[2]!)) {
        const [path, query] = m[2]!.split('?');
        args.method = m[1];
        args.path = path;
        if (query) args.query = Object.fromEntries(new URLSearchParams(query));
      } else if (op) {
        args.operation_id = op;
        const ids = Object.fromEntries([...endpoint.matchAll(/\{([a-z_]+)\}/g)].map((x) => [x[1]!, `${x[1]}_…`]));
        if (Object.keys(ids).length) args.path_params = ids;
      }
      break;
    }
    default:
      break;
  }
  return { tool, args };
}

/**
 * next_action as compact JSON: what to call (mcp_tool + args) and the type. The words are on the "Next:" line of the text,
 * so they are not repeated here.
 */
export function slimNext(next: unknown, data?: unknown, opTools: Record<string, string> = {}): Obj | null {
  if (!isObj(next) || typeof next.type !== 'string') return null;
  const call = nextToolCall(next as unknown as NextAction, data, opTools);
  return prune({ type: next.type, ...(call ? { mcp_tool: call.tool, args: call.args } : {}), ...(next.url && !call ? { url: next.url } : {}) });
}

/** A task's next step in a list: only its type (the plan's own next_action and get_task carry the rest). */
const nextType = (n: unknown): string | undefined => (isObj(n) && typeof n.type === 'string' ? n.type : undefined);

// ---------------------------------------------------------------------------------------------------------------------
// Owner questions
// ---------------------------------------------------------------------------------------------------------------------

/** owner_questions once: the ask (with the /todo link) and each question by id, text and options. */
export function compactOwnerQuestions(oq: unknown): Obj | undefined {
  if (!isObj(oq) || !Array.isArray(oq.questions)) return undefined;
  // Round 41: answers waiting for the owner's confirmation are never asked again: listed once, with the link.
  const waiting = (Array.isArray(oq.awaiting_confirmation) ? (oq.awaiting_confirmation as unknown[]) : []).filter(isObj).map((a) => prune({ id: a.id, answer: a.answer, confirmation_url: a.confirmation_url }));
  if (!oq.questions.length) return waiting.length ? { how: 'Do not ask these again: the owner confirms each answer at its link (their To-do page lists them all).', awaiting_confirmation: waiting } : undefined;
  const questions = (oq.questions as unknown[]).filter(isObj).map((q) => prune({ id: q.id, text: q.text, options: q.options }));
  // The ask's link to the owner's to-do page, when it names one.
  const link = /https?:\/\/\S+?\/todo\b\S*/.exec(String(oq.description ?? ''))?.[0]?.replace(/[.,:;]+$/, '');
  return prune({
    how: `Ask the human these once, in one message${link ? ` (the legal one at ${link}: send the link)` : ''}; then answer_task { task: <id>, answer } for each: it saves the answer and the question is never asked again. Keep fixing meanwhile.`,
    questions,
    ...(waiting.length ? { awaiting_confirmation: waiting } : {}),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Compliance plan
// ---------------------------------------------------------------------------------------------------------------------

const CLOSED = new Set(['done', 'wont_fix']);

/** A task's next step that its status already says (left out of the list). */
const IMPLIED_NEXT: Record<string, string> = { pending_live_check: 'live_check_pending', verifying: 'wait_for_verification' };

/** Whether a task's next step goes without saying: apply it (or, optional, suggest it), or what its status says. */
function impliedNext(t: Obj): boolean {
  const n = nextType(t.next_action);
  if (!n) return true;
  if (IMPLIED_NEXT[String(t.status)] === n) return true;
  return n === 'apply_task' || (n === 'optional_suggestion' && !!t.tier && t.tier !== 'required');
}

/** One open task in a list: id, title and what an agent needs to choose it (the full task: get_task). */
function taskLine(t: Obj): Obj {
  return prune({
    id: t.id,
    title: t.title,
    status: t.status,
    ...(t.tier && t.tier !== 'required' ? { tier: t.tier } : {}),
    ...(t.compliance_status && t.compliance_status !== t.status ? { compliance_status: t.compliance_status } : {}),
    ...(impliedNext(t) ? {} : { next: nextType(t.next_action) }),
    ...(Array.isArray(t.blocked_by) && t.blocked_by.length ? { blocked_by: t.blocked_by } : {}),
  });
}

/**
 * The default plan: status, the one next_action, owner questions once, open tasks as id + title (+ status, change type,
 * next step type), closed tasks as a count. get_task returns one task in full; verbose=true the API's full plan.
 */
export function compactPlanResult(plan: Obj, opTools: Record<string, string> = {}): Obj {
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []).filter(isObj);
  const openAll = tasks.filter((t) => !CLOSED.has(String(t.status)));
  // Round 39 (founder: "Before you launch" first; good practice as one count line): good-practice suggestions (tier
  // recommended / extra) are one line with their ids, never listed among the before-launch tasks.
  const good = openAll.filter((t) => typeof t.tier === 'string' && t.tier !== 'required');
  const open = openAll.filter((t) => !good.includes(t));
  const closed = tasks.filter((t) => CLOSED.has(String(t.status)));
  const g = isObj(plan.go_live) ? plan.go_live : null;
  const launch = isObj(plan.launch) ? plan.launch : null;
  return prune({
    object: plan.object,
    site: plan.site,
    status: plan.status,
    launch: launch?.label,
    next_action: slimNext(plan.next_action, plan, opTools),
    owner_questions: compactOwnerQuestions(plan.owner_questions),
    tasks: open.map(taskLine),
    good_practice: good.length ? { line: `${good.length} good-practice ${good.length === 1 ? 'suggestion' : 'suggestions'} (optional; never ${good.length === 1 ? 'blocks' : 'block'} launch)`, tasks: good.map((t) => t.id) } : undefined,
    closed: closed.length || undefined,
    go_live: g && Array.isArray(g.steps) && g.steps.length ? { steps_left: g.steps.length } : undefined,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Setup session
// ---------------------------------------------------------------------------------------------------------------------

const DONE_STEPS = new Set(['done', 'skipped', 'not_applicable']);

export interface SetupCompactOptions {
  /** 'ids' (default): owner questions by id (get_compliance_plan has their text); 'full': with text and options. */
  questions?: 'full' | 'ids';
}

/** owner_questions by id only (the text is in get_compliance_plan). */
function questionIds(oq: unknown): Obj | undefined {
  if (!isObj(oq) || !Array.isArray(oq.questions) || !oq.questions.length) return undefined;
  return { ids: (oq.questions as unknown[]).filter(isObj).map((q) => q.id), text: 'get_compliance_plan (owner_questions)' };
}

/**
 * One setup session, compact: the checklist (finished steps by key, open steps with a short summary), the one next_action,
 * owner questions once, the number of open plan tasks (get_compliance_plan lists them).
 */
function compactSession(s: Obj, opTools: Record<string, string>, o: SetupCompactOptions = {}): Obj {
  const top = s.next_action;
  const topType = nextType(top);
  const steps = (Array.isArray(s.steps) ? s.steps : []).filter(isObj);
  const done = steps.filter((st) => DONE_STEPS.has(String(st.status)));
  const open = steps.filter((st) => !DONE_STEPS.has(String(st.status)));
  const c = isObj(s.compliance) ? s.compliance : null;
  const todo = c && Array.isArray(c.todo) ? (c.todo as unknown[]).filter(isObj) : [];
  const stripe = isObj(s.stripe) ? s.stripe : null;
  const install = isObj(s.install) ? s.install : null;
  const snippetOpen = open.some((st) => st.key === 'snippet');
  const g = isObj(s.go_live) ? s.go_live : null;
  const first = isObj(s.first_check) ? s.first_check : null;
  return prune({
    id: s.id,
    object: s.object,
    status: s.status,
    site: s.site,
    live_site: s.live_site,
    next_action: slimNext(top, s, opTools),
    steps_done: done.map((st) => st.key),
    steps: open.map((st) => {
      const t = nextType(st.next_action);
      return prune({ key: st.key, status: st.status, summary: clip(st.summary, 120), ...(t && t !== topType ? { next: t } : {}) });
    }),
    compliance: c ? prune({ label: c.label, status: c.status, open_tasks: todo.length || undefined }) : undefined,
    owner_questions: o.questions === 'full' ? compactOwnerQuestions(s.owner_questions) : questionIds(s.owner_questions),
    // The unpinned snippet tag while the snippet step is open (the Next line gives the pinned one).
    install: install && snippetOpen ? prune({ script_tag: install.script_tag }) : undefined,
    stripe: stripe ? prune({ test_credential_stored: stripe.test_credential_stored, test_key_hint: stripe.test_key_hint, checkout_configs: stripe.checkout_configs }) : undefined,
    first_check: first ? prune({ evaluated: first.evaluated, scan: isObj(first.scan) ? first.scan.id : first.scan }) : undefined,
    go_live: g && Array.isArray(g.steps) && g.steps.length ? { steps_left: g.steps.length } : undefined,
    // The account publishable key (Checkbox Elements); the snippet key is in the snippet tag.
    publishable_key: Array.isArray(s.public_keys) ? (s.public_keys as unknown[]).filter(isObj).find((k) => k.key !== (install?.snippet_key ?? null) && String(k.name ?? '').startsWith('Account'))?.key : undefined,
    warnings: s.warnings,
  });
}

/**
 * The default setup result (setup_checkbox, get_setup_status, update_setup, complete_setup). A re-check response
 * ({ setup_session, domain_verified, unverified_scan, … }) is flattened onto its session, so the checklist is printed once.
 */
export function compactSetupResult(doc: Obj, opTools: Record<string, string> = {}, o: SetupCompactOptions = {}): Obj {
  const inner = isObj(doc.setup_session) ? doc.setup_session : isObj(doc.session) ? doc.session : null;
  if (!inner) return compactSession(doc, opTools, o);
  const merged: Obj = { ...inner, ...(doc.next_action !== undefined ? { next_action: doc.next_action } : {}), ...(doc.warnings ? { warnings: doc.warnings } : {}) };
  const u = isObj(doc.unverified_scan) ? doc.unverified_scan : null;
  return prune({
    ...compactSession(merged, opTools, o),
    domain_verified: doc.domain_verified,
    evaluated: doc.evaluated,
    scan: isObj(doc.scan) ? doc.scan.id : doc.scan,
    unverified_scan: u ? prune({ queued: u.queued, reason: u.reason }) : undefined,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Verification (verify_task, verify_site, get_verification)
// ---------------------------------------------------------------------------------------------------------------------

const PASSING = new Set(['pass', 'informational', 'not_applicable']);

/**
 * The default verification: status, plan status, what was checked, the checks that are not passing as `diff` (with what
 * was expected and seen, the API's word), counts for the rest, and the one next_action.
 */
export function compactVerificationResult(v: Obj, opTools: Record<string, string> = {}): Obj {
  const finals = (Array.isArray(v.checks) ? v.checks : []).filter(isObj);
  const pre = isObj(v.precheck) ? v.precheck : null;
  const preChecks = (pre && Array.isArray(pre.checks) ? pre.checks : []).filter(isObj);
  const usePre = v.status === 'pending' || !finals.length;
  const list = usePre ? preChecks.map((c) => ({ check_id: c.check_id, observed: c.status, detail: c.reason, fix: c.fix })) : finals.map((c) => ({ check_id: c.check_id, observed: c.observed, expected: c.expected, detail: c.detail, source: c.source }));
  const diff = (Array.isArray(v.diff) ? v.diff : []).filter(isObj);
  const failing = new Map<string, Obj>();
  for (const c of [...diff, ...list] as Obj[]) {
    const id = String(c.check_id ?? '');
    if (!id || PASSING.has(String(c.observed)) || failing.has(id)) continue;
    failing.set(id, prune({ check_id: id, observed: c.observed, ...(c.expected && c.expected !== 'pass' ? { expected: c.expected } : {}), detail: clip(c.detail, 200), fix: clip(c.fix, 300), ...(c.source === 'plan' ? { source: 'plan' } : {}) }));
  }
  const counts: Record<string, number> = {};
  for (const c of list) counts[String(c.observed)] = (counts[String(c.observed)] ?? 0) + 1;
  return prune({
    id: v.id,
    object: v.object,
    task: v.task,
    site: v.task ? undefined : v.site,
    status: v.status,
    plan_status: v.plan_status,
    plan_status_label: v.plan_status_label,
    checked: v.checked,
    checks: Object.keys(counts).length ? { ...(usePre ? { from: 'precheck' } : {}), ...counts } : undefined,
    diff: [...failing.values()],
    next_action: slimNext(v.next_action, v, opTools),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Test run
// ---------------------------------------------------------------------------------------------------------------------

/** The default test run: status, what it waits for, every step's status, details only for steps that did not pass. */
export function compactTestRunResult(run: Obj, opTools: Record<string, string> = {}): Obj {
  const steps = (Array.isArray(run.steps) ? run.steps : []).filter(isObj);
  const plan = isObj(run.plan_tested) ? run.plan_tested : null;
  const result = isObj(run.result) ? run.result : null;
  return prune({
    id: run.id,
    object: run.object,
    site: run.site,
    type: run.type,
    mode: run.mode,
    status: run.status,
    status_label: run.status_label,
    phase: run.status === 'succeeded' || run.status === 'failed' ? undefined : run.phase,
    waiting_for: run.waiting_for,
    inbox_address: run.status === 'succeeded' || run.status === 'failed' ? undefined : run.inbox_address,
    failure: run.failure,
    plan_tested: plan ? plan.summary ?? plan.name : undefined,
    plans_not_run: Array.isArray(run.plans_not_run) && run.plans_not_run.length ? run.plans_not_run : undefined,
    summary: result && isObj(result.summary) ? result.summary : undefined,
    plan_status_label: run.plan_status_label,
    steps: steps.map((s) => {
      const ok = s.status === 'passed' || s.status === 'skipped' || s.status === 'pending' || s.status === 'running';
      return prune({ key: s.key, title: s.title, status: s.status, code: s.code, ...(ok ? {} : { summary: clip(s.summary, 300), fix: isObj(s.fix) || typeof s.fix === 'string' ? s.fix : undefined }) });
    }),
    next_action: slimNext(run.next_action, run, opTools),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Every result
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The blocks the API repeats inside one object (a step's next_action equal to the session's, the same owner questions on
 * the plan and on the setup session, the Stripe key checklist). Content an agent applies (a task's change, corrected
 * params, email copy) is never replaced, even when two plans share it.
 */
const REPEATED_BLOCKS = new Set(['next_action', 'owner_questions', 'restricted_key', 'permissions', 'go_live', 'compliance', 'steps', 'todo', 'questions', 'site_plans']);

/**
 * Never the same block twice in one result: a block under one of REPEATED_BLOCKS that already appeared (at least `min`
 * characters of JSON) is replaced by "same as <path>". A top-level next_action becomes its tool call (its words are on
 * the "Next:" line). Pure.
 */
export function dedupeResult(data: unknown, opts: { min?: number; opTools?: Record<string, string> } = {}): unknown {
  const min = opts.min ?? 120;
  if (!data || typeof data !== 'object') return data;
  const seen = new Map<string, string>();
  const walk = (v: unknown, path: string, key: string): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (REPEATED_BLOCKS.has(key)) {
      const json = JSON.stringify(v);
      if (json.length >= min) {
        const first = seen.get(json);
        if (first !== undefined) return `same as ${first}`;
        seen.set(json, path);
      }
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, ''));
    const out: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) out[k] = walk(x, path ? `${path}.${k}` : k, k);
    return out;
  };
  const slimTop = (o: unknown): unknown => (isObj(o) && isObj(o.next_action) && typeof o.next_action.type === 'string' && ('message' in o.next_action || 'description' in o.next_action) ? { ...o, next_action: slimNext(o.next_action, o, opts.opTools) } : o);
  let root = slimTop(data);
  // An error result: its next_action is the Next line too.
  if (isObj(root) && isObj(root.error)) root = { ...root, error: slimTop(root.error) };
  return walk(root, '', '');
}
