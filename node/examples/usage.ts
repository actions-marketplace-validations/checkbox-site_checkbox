// The "Usage" section of the SDK README, kept compiling (examples/tsconfig.json). Run: CHECKBOX_API_KEY=ck_test_… npx tsx usage.ts
import Checkbox, { CheckboxError } from 'checkbox';

export async function usage(): Promise<void> {
  const checkbox = new Checkbox(process.env.CHECKBOX_API_KEY, {
    maxNetworkRetries: 2, // default
    timeout: 80_000, // ms per attempt
    appInfo: { name: 'my-app', version: '1.0.0' },
  });

  // Register a site (idempotent per key) and read its compliance plan: ordered tasks with the law, the exact change and
  // how to verify it. Every plan, task and error carries next_action for an AI agent.
  const site = await checkbox.sites.create({ url: 'https://acme.example' }, { idempotencyKey: 'site:acme.example' });
  const plan = await checkbox.plans.retrieve(site.id);
  for (const task of plan.tasks) console.log(task.id, task.title, task.requirement.citations[0]?.citation);

  // Apply a task's change, then verify it (long-poll up to 30 s).
  const first = plan.tasks[0];
  if (first) {
    const verification = await checkbox.tasks.verify(first.id, { wait: 30 });
    console.log(verification.status, verification.next_action);
  }

  // Every failing finding across pages.
  for await (const finding of checkbox.findings.list({ site: site.id, status: 'fail' })) {
    console.log(finding.check_id, finding.requirements[0]?.citation);
  }

  // Errors: branch on the stable code; nextAction says what to do.
  try {
    await checkbox.certificates.create(site.id);
  } catch (err) {
    if (!(err instanceof CheckboxError)) throw err;
    // resource_conflict: not eligible yet (verify the domain, stay compliant for 7 days);
    // account_not_activated: a live key before any domain is verified.
    console.log(err.code, err.message, err.nextAction);
  }
}
