// Express: preflight Stripe Checkout Session params with Checkbox, then create the session; plus the webhook receiver.
//   npm install checkbox stripe express      (Checkbox SDK publish name to be decided; see the SDK README)
//   CHECKBOX_API_KEY=ck_test_… CHECKBOX_WEBHOOK_SECRET=whsec_… STRIPE_SECRET_KEY=sk_test_… STRIPE_PRICE_ID=price_… node express-checkout.mjs
import express from 'express';
import Stripe from 'stripe';
import Checkbox, { CheckboxError, CheckboxSignatureVerificationError } from 'checkbox';

const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

const MERCHANT = { merchant_name: 'Acme', price: 19.99, currency: 'usd', interval: 'month', cancel_url: 'https://acme.example/account/cancel' };

// Webhooks first, with the RAW body (express.json() would break the signature).
app.post('/webhooks/checkbox', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = checkbox.webhooks.constructEvent(req.body, req.headers['checkbox-signature'], process.env.CHECKBOX_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof CheckboxSignatureVerificationError) return res.status(400).send(err.message);
    throw err;
  }
  console.log('checkbox event', event.type, event.id);
  res.json({ received: true });
});

app.post('/checkout', express.json(), async (req, res) => {
  let params = {
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${req.protocol}://${req.get('host')}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${req.protocol}://${req.get('host')}/pricing`,
  };
  try {
    const check = await checkbox.checks.stripeCheckoutSession({ params, merchant: MERCHANT });
    if (check.verdict === 'fail') params = check.correction.corrected_params; // Checkbox's engine-verified fix
  } catch (err) {
    // Never block a sale on Checkbox being unreachable; log and continue with your params.
    if (!(err instanceof CheckboxError) || err.type === 'invalid_request_error') throw err;
    console.warn('Checkbox preflight unavailable:', err.code, err.requestId);
  }
  const session = await stripe.checkout.sessions.create(params);
  res.json({ url: session.url });
});

app.listen(process.env.PORT ?? 3000, () => console.log('listening'));
