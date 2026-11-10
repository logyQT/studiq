import { EXIT_CONFLICT, EnvFailure } from './exit';
import { REPO_ROOT, isThisCheckout, isThisCheckoutWorkdir } from './repo';
import type { StackRead } from './stack';

/**
 * Ownership guards for commands that read from (or act on) a stack: a foreign
 * `SUPABASE_WORKDIR` and a stack resolved from another checkout are both
 * refused before any value is read or any mutation is attempted.
 */

/**
 * `runSupabase` inherits `SUPABASE_WORKDIR`, and the CLI resolves the stack
 * against it. Reject a foreign workdir before the first status/start/stop so
 * this checkout can never discover, start, stop — or reset — another
 * checkout's stack.
 */
export function assertOwnWorkdir(): void {
  const workdir = process.env.SUPABASE_WORKDIR || null;
  if (workdir !== null && !isThisCheckoutWorkdir(workdir)) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `refusing to run with SUPABASE_WORKDIR '${workdir}': it is not this checkout (${REPO_ROOT}).`,
    );
  }
}

/**
 * A stack read from status is only usable when `project_root` is this checkout.
 * Stack identity in stack mode is project root + name + branch, so this root
 * check also rejects a named stack resolved from another checkout/branch: this
 * checkout's root is the only one a command may act on.
 */
export function assertOwnedStack(stack: StackRead, stackName: string | null): void {
  if (!isThisCheckout(stack.status.projectRoot)) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `stack '${stackName || 'default'}' belongs to ${stack.status.projectRoot || 'an unknown checkout'}, not this checkout (${REPO_ROOT}); run 'env:down --all' then 'env:ensure' in its checkout.`,
    );
  }
}
