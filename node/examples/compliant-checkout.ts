// Preflight Stripe Checkout Session params with Checkbox before creating the session.
// Used by the Next.js route (nextjs/app/api/checkout/route.ts) and the Express server (express-checkout.mjs).
//
// Checkbox checks the params against automatic-renewal laws (ROSCA, California, New York, …) and returns a corrected
// copy (consent collection, renewal terms next to the button, cancellation instructions). Applying the correction is
// deterministic: the same input always gives the same params.
import Checkbox, { CheckboxError, type CheckPlanTerms, type StripeCheckoutSessionCheckResult } from '@checkbox-site/node';

export interface CompliantParams {
  /** Params to pass to stripe.checkout.sessions.create(). */
  params: Record<string, unknown>;
  /** The check that approved them (keep check.id in your logs: it is the evidence of what you checked). */
  check: StripeCheckoutSessionCheckResult;
  /** True when Checkbox changed the params. */
  corrected: boolean;
}

/**
 * Returns Checkout Session params that pass Checkbox's checks: the original params when they pass, else Checkbox's
 * corrected params. Throws when even the corrected params fail (a human has to decide, see check.next_action).
 */
export async function compliantCheckoutParams(
  checkbox: Checkbox,
  params: Record<string, unknown>,
  merchant: CheckPlanTerms,
): Promise<CompliantParams> {
  const check = await checkbox.checks.stripeCheckoutSession({ params, merchant });
  if (check.verdict !== 'fail') return { params, check, corrected: false };
  const corrected = check.correction.corrected_params;
  const recheck = await checkbox.checks.stripeCheckoutSession({ params: corrected, merchant });
  if (recheck.verdict === 'fail') {
    throw new Error(`Checkout params still fail automatic-renewal checks: ${recheck.next_action.message}`);
  }
  return { params: corrected, check: recheck, corrected: true };
}

/**
 * Same as compliantCheckoutParams, but never blocks a sale when Checkbox is unreachable: falls back to the original
 * params and reports the error (log it; your monitoring will flag the checkout later).
 */
export async function compliantCheckoutParamsOrOriginal(
  checkbox: Checkbox,
  params: Record<string, unknown>,
  merchant: CheckPlanTerms,
): Promise<CompliantParams | { params: Record<string, unknown>; check: null; corrected: false; error: CheckboxError }> {
  try {
    return await compliantCheckoutParams(checkbox, params, merchant);
  } catch (err) {
    if (err instanceof CheckboxError && (err.type === 'connection_error' || err.type === 'api_error' || err.type === 'rate_limit_error')) {
      return { params, check: null, corrected: false, error: err };
    }
    throw err;
  }
}
