/**
 * Shared CLI shell for the two tenant seeders.
 *
 * `scripts/e2e-seed.ts` seeds one tenant per Playwright test, `scripts/qa-tenant.ts`
 * one per QA case. Everything that is not about the tenant *shape* lives here:
 * argv parsing, env resolution, the optional direct-Postgres account writer,
 * bounded concurrency, output conventions and exit codes. Each plan module keeps
 * only its own tenant shape.
 *
 * This split is deliberately behaviour-neutral: the strings printed and the exit
 * codes are part of the CI contract, so the helpers below reproduce the two
 * scripts' previous code byte for byte rather than inventing a new CLI style.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export { concurrencyFromEnv, createSeedDb, runBounded } from '#test/helpers/tenant-seed';

/** `--name value` or `--name=value`; `undefined` when the flag is absent. */
export function option(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Boolean `--flag` (no value). */
function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** `--reset` — drop the tenants this plan owns instead of seeding them. */
export function resetRequested(args: string[]): boolean {
  return flag(args, 'reset');
}

/**
 * Env lookup with the app's env file as a fallback.
 *
 * Reads `apps/web/.env` (the file `bun dev:up` renders) and nothing else; a
 * missing value is a hard error, because a silent port fallback could seed a
 * different checkout's database.
 */
export function envFromWebFile(root: string, name: string): string {
  if (process.env[name]) return process.env[name];
  try {
    const raw = readFileSync(join(root, 'apps/web/.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
    }
  } catch {
    /* no .env */
  }
  throw new Error(`missing env ${name}`);
}
