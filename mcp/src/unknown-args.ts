// Round 12 (change-guard): MCP tools registered their input without .strict(), so zod dropped unknown arguments.
// verify_task with `stripe_params` (a misspelled stripe_checkout_session) found no params, judged the Checkout Sessions
// read from Stripe and read PASSED. Unknown arguments are now refused with the closest known name.

/** Names agents use for an argument, mapped to the real one (checked before the edit distance). */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  stripe_params: 'stripe_checkout_session',
  checkout_params: 'stripe_checkout_session',
  session_params: 'stripe_checkout_session',
  checkout_session: 'stripe_checkout_session',
  stripe_session: 'stripe_checkout_session',
  session: 'stripe_checkout_session',
  sessions: 'stripe_checkout_sessions',
  task_id: 'task',
  site_id: 'site',
  plan_terms: 'terms',
  merchant: 'terms',
  terms: 'merchant',
  body: 'text',
  page_html: 'html',
  price: 'price_id',
  name: 'merchant_name',
  brand: 'merchant_name',
  price_cents: 'amount',
  amount_cents: 'amount',
  unit_amount: 'amount',
  trial_period_days: 'trial_days',
  billing_interval: 'interval',
});

/** Levenshtein distance (small inputs: argument names). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The known argument an unknown one most likely means, if any is close enough. */
export function closestArgument(unknown: string, known: readonly string[]): string | undefined {
  const k = unknown.toLowerCase();
  const alias = ALIASES[k];
  if (alias && known.includes(alias)) return alias;
  let best: { name: string; d: number } | undefined;
  for (const name of known) {
    const d = editDistance(k, name.toLowerCase());
    if (!best || d < best.d) best = { name, d };
  }
  if (best && best.d <= Math.max(2, Math.floor(best.name.length / 3))) return best.name;
  // A prefix / containment match ("stripe" → stripe_checkout_session) when exactly one known name fits.
  const contains = known.filter((n) => n.length >= 4 && (n.includes(k) || k.includes(n)));
  return contains.length === 1 ? contains[0] : undefined;
}

/**
 * Round 21 (pilot 20 item 5): an unknown argument that is an alias or a near spelling of a known one (stripe_params,
 * emial), as opposed to a field this server does not know yet (plan_variant): those are forwarded to the API, which
 * refuses what it does not know either. A name that only contains a known one is not a misspelling here.
 */
export function likelyMisspelling(unknown: string, known: readonly string[]): string | undefined {
  const k = unknown.toLowerCase();
  const alias = ALIASES[k];
  if (alias && known.includes(alias)) return alias;
  let best: { name: string; d: number } | undefined;
  for (const name of known) {
    const d = editDistance(k, name.toLowerCase());
    if (!best || d < best.d) best = { name, d };
  }
  return best && best.d <= Math.max(2, Math.floor(best.name.length / 3)) ? best.name : undefined;
}

/** The error an agent reads for unknown arguments: each with a suggestion, then every argument the tool accepts. */
export function unknownArgumentsMessage(tool: string, keys: readonly string[], known: readonly string[]): string {
  const parts = keys.map((key) => {
    const hint = closestArgument(key, known);
    return `unknown argument \`${key}\`${hint ? `; did you mean \`${hint}\`?` : ''}`;
  });
  return `${parts.join('. ')}. Nothing was checked. ${tool} accepts: ${known.join(', ')}.`;
}

/**
 * Pilot round 13: an unknown key inside a nested object (plans[].price_cents, merchant.name) is refused, naming the
 * closest field. `hints` maps keys to a fuller suggestion for this object (e.g. price → amount in minor units).
 */
export function nestedUnknownMessage(where: string, keys: readonly string[], known: readonly string[], hints: Readonly<Record<string, string>> = {}): string {
  const parts = keys.map((key) => {
    const hint = hints[key.toLowerCase()] ?? closestArgument(key, known);
    return `unknown field \`${where}.${key}\`${hint ? `; did you mean \`${where}.${hint}\`?` : ''}`;
  });
  return `${parts.join('. ')}. Nothing was changed. ${where} accepts: ${known.join(', ')}.`;
}

/**
 * Object params that word the unknown-keys error on both zod majors: the monorepo builds against zod 3 (`errorMap`),
 * the published server ships zod 4 (`error`). Other issues keep zod's own message.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unknownKeysParams(message: (keys: string[]) => string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pick = (issue: any): string | undefined => (issue?.code === 'unrecognized_keys' ? message(issue.keys as string[]) : undefined);
  return {
    // zod 3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errorMap: (issue: any, ctx: any) => {
      const m = pick(issue);
      return m !== undefined ? { message: m } : ctx ? { message: ctx.defaultError } : undefined;
    },
    // zod 4 (undefined falls through to the default message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: (issue: any) => pick(issue),
  };
}
