// Next.js (App Router): app/api/checkout/route.ts
// Creates a Stripe Checkout Session whose params Checkbox has checked (and corrected) for automatic-renewal laws.
//   npm install checkbox stripe      (Checkbox SDK publish name to be decided; see the SDK README)
//   CHECKBOX_API_KEY=ck_test_…  STRIPE_SECRET_KEY=sk_test_…
import Checkbox from 'checkbox';
import Stripe from 'stripe';
import { compliantCheckoutParamsOrOriginal } from '../../../../compliant-checkout';

const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Your plan, in the words the law cares about (Checkbox writes the disclosure from these).
const MERCHANT = {
  merchant_name: 'Acme',
  price: 19.99,
  currency: 'usd',
  interval: 'month',
  trial_days: 7,
  cancel_url: 'https://acme.example/account/cancel',
};

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const params = {
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  };
  const result = await compliantCheckoutParamsOrOriginal(checkbox, params, MERCHANT);
  if ('error' in result) console.warn('Checkbox preflight unavailable, using original params:', result.error.code, result.error.requestId);
  else if (result.corrected) console.info('Checkbox corrected the Checkout params (check %s)', result.check.id);

  const session = await stripe.checkout.sessions.create(result.params as unknown as Stripe.Checkout.SessionCreateParams);
  return Response.json({ url: session.url });
}
