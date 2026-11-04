// One to-do list (MCP side): the compliance plan's ordered open required tasks, in the status words every surface uses.
// The same rule as the server's own to-do list (this package is published on its own, so it carries a copy); the
// server's tests assert both give the same list for every fixture.

export type TodoStatus = 'needs_fix' | 'not_set_up' | 'your_call' | 'not_checked';

const LABELS: Record<TodoStatus, string> = {
  needs_fix: 'Needs a fix',
  not_set_up: 'Not set up yet',
  your_call: 'Your call',
  not_checked: 'Not checked yet',
};

export interface TodoTaskLike {
  id: string;
  key: string;
  title: string;
  order?: number | null;
  status: string;
  tier?: string | null;
  compliance_status?: string | null;
  findings?: readonly string[];
  check_ids?: readonly string[];
}

export interface TodoItem {
  id: string;
  key: string;
  title: string;
  status: TodoStatus;
  label: string;
  findings: string[];
  check_ids: string[];
}

function isTodo(t: TodoTaskLike): boolean {
  if ((t.tier ?? 'required') !== 'required') return false;
  const st = t.compliance_status;
  if (!st || !(st in LABELS)) return false;
  // A question a person already closed is decided; an accepted violation stays "Needs a fix".
  if (st === 'your_call' && (t.status === 'wont_fix' || t.status === 'done')) return false;
  return true;
}

/** The plan's open required tasks in plan order. */
export function planTodo(tasks: readonly TodoTaskLike[]): TodoItem[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isTodo(t))
    .sort((a, b) => (a.t.order ?? a.i + 1) - (b.t.order ?? b.i + 1) || a.i - b.i)
    .map(({ t }) => {
      const status = t.compliance_status as TodoStatus;
      return { id: t.id, key: t.key, title: t.title, status, label: LABELS[status], findings: [...(t.findings ?? [])], check_ids: [...(t.check_ids ?? [])] };
    });
}

/** "Title — Needs a fix". */
export function todoLine(t: Pick<TodoItem, 'title' | 'label'>): string {
  return `${t.title} — ${t.label}`;
}
