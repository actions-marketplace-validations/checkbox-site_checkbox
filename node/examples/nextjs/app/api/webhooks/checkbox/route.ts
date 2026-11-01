// Next.js (App Router): app/api/webhooks/checkbox/route.ts
// Receives Checkbox webhooks (findings, plan updates, test runs, certificates, …) and verifies Checkbox-Signature.
//   Create the endpoint once: checkbox.webhookEndpoints.create({ url: 'https://yoursite.com/api/webhooks/checkbox', enabled_events: ['*'] })
//   and store its secret as CHECKBOX_WEBHOOK_SECRET (whsec_…).
import Checkbox, { CheckboxSignatureVerificationError, type WebhookEvent } from 'checkbox';

const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY);

/** What your app does with each event. Replace the bodies with your own handling. */
export async function handleEvent(event: WebhookEvent): Promise<string> {
  switch (event.type) {
    case 'finding.created':
      return `New compliance finding on ${String((event.data?.object as { site?: string } | undefined)?.site ?? 'a site')}`;
    case 'plan.updated':
      return `Compliance plan for ${event.data?.object.site} is now ${event.data?.object.status}`;
    case 'site.compliant':
      return 'Site is compliant';
    case 'test_run.completed':
    case 'test_run.failed':
      return `Test subscription ${event.type.split('.')[1]}`;
    default:
      return `Ignored ${event.type}`;
  }
}

export async function POST(request: Request): Promise<Response> {
  const payload = await request.text(); // the RAW body: re-serialised JSON would not match the signature
  let event: WebhookEvent;
  try {
    // On the Edge runtime use: await checkbox.webhooks.constructEventAsync(...)
    event = checkbox.webhooks.constructEvent(payload, request.headers.get('checkbox-signature'), process.env.CHECKBOX_WEBHOOK_SECRET!);
  } catch (err) {
    if (err instanceof CheckboxSignatureVerificationError) return new Response(err.message, { status: 400 });
    throw err;
  }
  const handled = await handleEvent(event);
  return Response.json({ received: true, handled });
}
