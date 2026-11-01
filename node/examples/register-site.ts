// Register a site, print the snippet to install, and subscribe a webhook endpoint (run once, e.g. from a setup script).
//   CHECKBOX_API_KEY=ck_test_… npx tsx register-site.ts https://yoursite.com https://yoursite.com/api/webhooks/checkbox
// (Or let your coding agent run `checkbox init`, which does all of this and more with one browser approval.)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Checkbox from 'checkbox';

export async function registerSite(checkbox: Checkbox, siteUrl: string, webhookUrl?: string) {
  // Idempotency-Key per site URL: re-running the script returns the same site instead of creating a second one.
  const site = await checkbox.sites.create(
    { url: siteUrl, platform: 'stripe', jurisdictions: [] },
    { idempotencyKey: `register-site:${siteUrl}` },
  );
  const endpoint = webhookUrl
    ? await checkbox.webhookEndpoints.create({ url: webhookUrl, enabled_events: ['finding.created', 'plan.updated', 'site.compliant', 'test_run.completed', 'test_run.failed'] })
    : null;
  const plan = await checkbox.plans.retrieve(site.id);
  return { site, endpoint, plan };
}

async function main() {
  const [siteUrl, webhookUrl] = process.argv.slice(2);
  if (!siteUrl) throw new Error('usage: register-site.ts <site url> [webhook url]');
  const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY);
  const { site, endpoint, plan } = await registerSite(checkbox, siteUrl, webhookUrl);
  console.log(`Site ${site.id} (${checkbox.mode} mode)`);
  console.log(`1. Add to your <head>: ${site.install.script_tag}`);
  if (endpoint) console.log(`2. Store CHECKBOX_WEBHOOK_SECRET=${endpoint.secret}`);
  console.log(`Next: ${plan.next_action.description}${plan.next_action.command ? ` (${plan.next_action.command})` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
