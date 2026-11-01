// The README quickstart, kept compiling (examples/tsconfig.json).
import Checkbox from 'checkbox';

export async function quickstart(sessionParams: Record<string, unknown>): Promise<Record<string, unknown>> {
  const checkbox = new Checkbox(); // reads CHECKBOX_API_KEY, then CHECKBOX_SECRET_KEY (ck_test_… written by `checkbox init`)
  const check = await checkbox.checks.stripeCheckoutSession({ params: sessionParams, merchant: { merchant_name: 'Acme', price: 19.99, interval: 'month' } });
  console.log(check.verdict, check.next_action.message);
  const params = check.verdict === 'fail' ? check.correction.corrected_params : sessionParams; // engine-verified fix
  return params;
}
