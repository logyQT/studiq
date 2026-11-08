import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../lib/repo';
import { writeStderrLine } from '../lib/output';

/**
 * Passthrough to `bunx supabase` from the checkout root.
 *
 * `supabase/config.toml` resolves `APP_URL` through `env()`, and the CLI reads
 * no values file, so the resolved APP_URL is exported around the child. Values
 * come from the process environment (varlock injects them for this command);
 * an explicit APP_URL wins, exactly like `scripts/dev supa`.
 */
export function runSupa(args: string[]): number {
  // Hard rule: never `supabase stop --all` (it stops every stack on the
  // machine, including other checkouts'). Scan tokens, not positions, so any
  // argument order is caught; everything else is forwarded untouched.
  if (args.includes('stop') && args.includes('--all')) {
    writeStderrLine(
      "env:supa: refusing 'stop --all' — it stops every Supabase stack on the machine. " +
        "Stop only this checkout's stack with 'stack stop --stack <name>'.",
    );
    return 2;
  }

  const appUrl = process.env.APP_URL || `http://localhost:${process.env.APP_PORT || '3000'}`;
  const result = spawnSync('bunx', ['supabase', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, APP_URL: appUrl },
    stdio: 'inherit',
  });

  if (result.error) {
    writeStderrLine(`env:supa: cannot run bunx: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
