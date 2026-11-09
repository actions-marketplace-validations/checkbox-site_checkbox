// Round 25 (pilot 24 item 12, security-reviewer): the stdio device login returned the full ck_test_ secret key in the
// tool result, so it landed in the LLM transcript (and in whatever logs the client keeps). The local stdio server now
// writes the issued keys to a git-ignored file in the project itself and returns only a hint ("ck_test_…ab12" and the
// file name). The next start of `checkbox-mcp` in the same folder reads the key back from that file.
//
// Where: .env.local in the project folder (what `checkbox init` writes, and what most frameworks load), unless git
// tracks .env.local (a secret written there would go into the next commit even with .gitignore): then
// .checkbox/keys.env, in a folder whose own .gitignore ignores everything.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface KeysToSave {
  secret_key: string;
  publishable_key?: string | null;
  live_secret_key?: string | null;
  live_publishable_key?: string | null;
}

export type SavedKeys = { ok: true; file: string; gitignored: boolean; note?: string } | { ok: false; error: string };

export const ENV_FILE = '.env.local';
export const FALLBACK_FILE = '.checkbox/keys.env';

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function gitTracked(root: string, file: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function gitIgnores(root: string, file: string): boolean | null {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', file], { cwd: root, stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (err) {
    // Exit 1: not ignored. Anything else (no git, not a repository): unknown.
    return (err as { status?: number }).status === 1 ? false : null;
  }
}

function upsertLines(existing: string | null, entries: Array<[string, string]>, header: string): string {
  let text = existing ?? '';
  const missing: Array<[string, string]> = [];
  for (const [k, v] of entries) {
    const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${k}[ \\t]*=.*$`, 'gm');
    // A function replacement: a value is never read as a "$&" pattern. Every earlier assignment gets the new value.
    if (re.test(text)) text = text.replace(re, () => `${k}=${v}`);
    else missing.push([k, v]);
  }
  if (missing.length) {
    const block = [header, ...missing.map(([k, v]) => `${k}=${v}`)];
    text = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block.join('\n')}\n`;
  }
  return text;
}

/** Makes sure .gitignore covers .env.local (only in a git project, or when a .gitignore already exists). */
function ensureIgnored(root: string, file: string): boolean {
  const ignored = gitIgnores(root, file);
  if (ignored === true) return true;
  const path = join(root, '.gitignore');
  const existing = read(path);
  if (existing !== null) {
    const lines = existing.split(/\r?\n/).map((l) => l.trim());
    if (lines.some((l) => l === file || l === `/${file}` || l === '.env*' || l === '.env*.local' || l === '*.local' || l === '.env.local*')) return true;
  }
  if (existing === null && !existsSync(join(root, '.git'))) return false;
  writeFileSync(path, `${existing ?? ''}${existing && !existing.endsWith('\n') ? '\n' : ''}# Checkbox keys (checkbox-mcp)\n${file}\n`);
  return true;
}

/** Writes the issued keys to the project's git-ignored env file. Never throws. */
export function saveKeysToProject(root: string, keys: KeysToSave): SavedKeys {
  const entries: Array<[string, string]> = [['CHECKBOX_SECRET_KEY', keys.secret_key]];
  if (keys.publishable_key) entries.push(['CHECKBOX_PUBLISHABLE_KEY', keys.publishable_key]);
  if (keys.live_secret_key) entries.push(['CHECKBOX_LIVE_SECRET_KEY', keys.live_secret_key]);
  if (keys.live_publishable_key) entries.push(['CHECKBOX_LIVE_PUBLISHABLE_KEY', keys.live_publishable_key]);
  const header = '# Checkbox (subscription compliance), written by checkbox-mcp. Secret: never commit this file.';
  try {
    if (!gitTracked(root, ENV_FILE)) {
      const path = join(root, ENV_FILE);
      writeFileSync(path, upsertLines(read(path), entries, header), { mode: 0o600 });
      try {
        chmodSync(path, 0o600);
      } catch {
        // best effort (some file systems ignore modes)
      }
      const gitignored = ensureIgnored(root, ENV_FILE);
      return { ok: true, file: ENV_FILE, gitignored };
    }
    const dir = join(root, '.checkbox');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (read(join(dir, '.gitignore')) === null) writeFileSync(join(dir, '.gitignore'), '# Checkbox local secrets: never committed\n*\n');
    const path = join(root, FALLBACK_FILE);
    writeFileSync(path, upsertLines(read(path), entries, header), { mode: 0o600 });
    return { ok: true, file: FALLBACK_FILE, gitignored: true, note: `${ENV_FILE} is tracked by git, so the key was not written there.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The value of NAME in a dotenv-style text: `NAME=value`, `export NAME=value`, quoted or not, with an optional trailing
 * comment; the last assignment wins, as in dotenv loaders.
 *
 * Round 29 (pilot 28 item 10, security-reviewer): the reader only accepted [A-Za-z0-9_], but keys are base64url
 * (packages/db/src/repos/api-v1.ts newKeyString), so about half contain "-". Those keys were saved and then never read
 * back: each restart of checkbox-mcp started without a key and asked for a new device login.
 */
export function readEnvValue(text: string, name: string): string | undefined {
  const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s#]*))[ \\t]*(?:#.*)?$`, 'gm');
  let found: string | undefined;
  for (let m = re.exec(text); m; m = re.exec(text)) found = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  return found || undefined;
}

/** Every key an earlier device login saved in this folder (.env.local, then .checkbox/keys.env), per variable. */
export function readSavedKeys(root: string): Partial<KeysToSave> & { file?: string } {
  for (const file of [ENV_FILE, FALLBACK_FILE]) {
    const text = read(join(root, file));
    if (!text) continue;
    const secret = readEnvValue(text, 'CHECKBOX_SECRET_KEY');
    if (!secret) continue;
    const out: Partial<KeysToSave> & { file?: string } = { secret_key: secret, file };
    const pk = readEnvValue(text, 'CHECKBOX_PUBLISHABLE_KEY');
    const live = readEnvValue(text, 'CHECKBOX_LIVE_SECRET_KEY');
    const livePk = readEnvValue(text, 'CHECKBOX_LIVE_PUBLISHABLE_KEY');
    if (pk) out.publishable_key = pk;
    if (live) out.live_secret_key = live;
    if (livePk) out.live_publishable_key = livePk;
    return out;
  }
  return {};
}

/** The CHECKBOX_SECRET_KEY saved by an earlier device login in this folder (.env.local, then .checkbox/keys.env). */
export function readSavedKey(root: string): string | undefined {
  return readSavedKeys(root).secret_key;
}
