import { spawnSync } from 'node:child_process';
import { UsageError } from '../atoms';
import { exportedStackEnv, resolveLocalAppEnv } from '../lib/app-env';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { writeStderrLine } from '../lib/output';
import { assertOwnedStack, assertOwnWorkdir } from '../lib/ownership';
import { REPO_ROOT } from '../lib/repo';
import { readStack } from '../lib/stack';
import { applyStackEnv } from '../lib/stack-lifecycle';

const USAGE_LINE = 'bun run env:run -- <command> [args…]';

const SUPABASE_REFUSAL =
  "env:run: refusing to run the Supabase CLI — use 'bun run env:supa', which owns the destructive-subcommand guards.";

/**
 * `supabase`, `bunx`/`npx supabase`, and any path whose last segment is
 * `supabase` (a local `node_modules/.bin` or `/usr/local/bin` install).
 */
function targetsSupabase(target: string, rest: string[]): boolean {
  const name = target.split('/').pop() ?? target;
  if (name === 'supabase') return true;
  return (name === 'bunx' || name === 'npx') && rest[0] === 'supabase';
}

/**
 * Run one command from the checkout root with this checkout's resolved
 * environment exported: the app contract (`APP_URL`, `APP_PORT`, `APP_ENV`,
 * `NEXT_PUBLIC_SITE_URL`) plus the stack's `NEXT_PUBLIC_SUPABASE_URL`,
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
 * `SUPABASE_DB_URL`, and `QA_APP_URL` pointing at this checkout's app.
 *
 * The QA seeder and the QA runner read the stack from the environment and
 * cannot reach the values `ensure` exports only to its own children, so without
 * this a UI-only spec silently falls back to the shared `:3010` app.
 *
 * Never starts or stops anything: a running stack is read through the same
 * `readStack`/`applyStackEnv` path `serve` uses, and a stopped one is only
 * usable when the environment already carries the contract. Stdio is inherited
 * so a reporter, a prompt or `--watch` behaves exactly as a direct run.
 */
export function runCommand(args: string[]): number {
  const [target, ...rest] = args;
  if (!target) throw new UsageError(`'run' needs a command: ${USAGE_LINE}`);
  if (targetsSupabase(target, rest)) {
    writeStderrLine(SUPABASE_REFUSAL);
    return 2;
  }

  assertOwnWorkdir();
  const appEnv = resolveLocalAppEnv();
  const contract = contractWithLease(readContract());
  process.env.APP_PORT = String(contract.appPort);
  process.env.APP_URL = contract.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;

  const stack = contract.shared ? null : readStack(contract.stackName);
  if (stack) assertOwnedStack(stack, contract.stackName);
  const stackEnv = stack ? stack.env : exportedStackEnv();
  if (!stackEnv) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      contract.shared
        ? 'SUPABASE_SHARED=1 needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
        : "no running Supabase stack for this checkout and no Supabase contract in the environment; run 'bun run env:ensure --profile web' (or 'bun run env:ensure --profile qa') first",
    );
  }
  applyStackEnv(stackEnv, { appUrl: contract.appUrl, appEnv, stackId: stack?.status.id });
  process.env.QA_APP_URL = contract.appUrl;

  const result = spawnSync(target, rest, { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  if (result.error) {
    writeStderrLine(`env:run: cannot run '${target}': ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
