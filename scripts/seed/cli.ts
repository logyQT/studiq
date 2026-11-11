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
import { SQL } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_TARGET_LOCKED } from '../env/lib/seed';
import { createSqlAccountWriter, type AccountWriter } from '#test/helpers/tenant-seed';

export { concurrencyFromEnv, createSeedDb, runBounded } from '#test/helpers/tenant-seed';

/** Print a failure to stderr and exit with the CLI's usage-error code. */
export function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** `--name value` or `--name=value`; `undefined` when the flag is absent. */
export function option(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Boolean `--flag` (no value). */
export function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** `--reset` — drop the tenants this plan owns instead of seeding them. */
export function resetRequested(args: string[]): boolean {
  return flag(args, 'reset');
}

/** `--run <suffix>` — fold one run id into every tenant key. */
export function runOption(args: string[]): string | undefined {
  return option(args, 'run');
}

/** Positive integer CLI option, with a default and a readable error. */
export function countOption(args: string[], name: string, fallback: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    fail(`--${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

/**
 * Env lookup with the root values file as a fallback.
 *
 * Reads root `.env.local` (the single hand-edited values file, see `.env.schema`)
 * and nothing else; a missing value is a hard error, because a silent port
 * fallback could seed a different checkout's database.
 */
export function envFromValuesFile(root: string, name: string): string {
  if (process.env[name]) return process.env[name];
  try {
    const raw = readFileSync(join(root, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
    }
  } catch {
    /* no .env.local */
  }
  throw new Error(`missing env ${name}`);
}

/** `host:port` of a URL, or null when it cannot be parsed. */
function urlEndpoint(raw: string | undefined): { host: string; port: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { host: url.hostname.toLowerCase(), port: url.port };
  } catch {
    return null;
  }
}

/** True only when both URLs parse and identify the same host and port. */
function sameEndpoint(a: string | undefined, b: string | undefined): boolean {
  const left = urlEndpoint(a);
  const right = urlEndpoint(b);
  return left !== null && right !== null && left.host === right.host && left.port === right.port;
}

/**
 * Load env for the QA seeder from root `.env.local`, then `qa/env.json`.
 *
 * The process environment wins over both; `.env.local` only fills keys it does
 * not already set. `qa/env.json` names the shared stack QA workers run against,
 * so it overrides the checkout's own `NEXT_PUBLIC_SUPABASE_URL` — unless the
 * child was started by `env:ensure` with a checked-stack target
 * (`STUDIQ_SEED_LOCKED_TARGET=1`), in which case that endpoint is authoritative
 * and must not be swapped for the shared stack.
 */
export function loadEnv(root: string): void {
  const path = join(root, '.env.local');
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i <= 0 || line.trim().startsWith('#')) continue;
      const name = line.slice(0, i).trim();
      if (!process.env[name]) process.env[name] = line.slice(i + 1).trim();
    }
  }
  if (process.env[SEED_TARGET_LOCKED] === '1') return;
  // QA workers share one app and one Supabase even though each worktree keeps
  // its own `.env.local`; `qa/env.json` names the shared stack the spec runs
  // against.
  const configPath = join(root, 'qa', 'env.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { supabaseUrl?: string };
      if (config.supabaseUrl) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = config.supabaseUrl;
        // The SQL writer bypasses the REST gateway: a `SUPABASE_DB_URL` from
        // this checkout's `.env.local` would then write auth users into a
        // different database than the one the REST/Admin-API calls target.
        // Keep it only when both URLs identify the same endpoint; otherwise
        // fall back to the Admin API. Never print the URL or its credentials.
        const dbUrl = process.env.SUPABASE_DB_URL;
        if (dbUrl && !sameEndpoint(config.supabaseUrl, dbUrl)) {
          delete process.env.SUPABASE_DB_URL;
          console.error(
            'qa-seed: direct-Postgres account writer disabled — SUPABASE_DB_URL targets a different endpoint than qa/env.json; using the Admin API',
          );
        }
      }
    } catch {
      // A malformed qa/env.json should not hide the real seeding error.
    }
  }
}

/**
 * `SUPABASE_DB_URL` as a direct Postgres connection, when it is set.
 *
 * Optional: without it the seeders write auth users through GoTrue's admin API
 * instead of the single-statement SQL writer.
 */
export function optionalSql(url = process.env.SUPABASE_DB_URL): SQL | undefined {
  return url ? new SQL(url) : undefined;
}

/** Batch writer for the optional direct-Postgres path. */
export function optionalAccountWriter(sql: SQL | undefined): AccountWriter | undefined {
  return sql ? createSqlAccountWriter(sql) : undefined;
}

/** `--json`: the tenant object, 2-space indent, no wrapper and no extra keys. */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** One write per tenant block, so concurrently seeded cases cannot interleave. */
export function printBlock(lines: string[]): void {
  console.log(lines.join('\n'));
}

/** Close the optional SQL connection, then exit with `code`. */
export async function finish(sql: SQL | undefined, code: number): Promise<never> {
  if (sql) await sql.close();
  process.exit(code);
}
