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
