import type { ParsedCommand, RuntimeChoice } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { readContractLenient } from '../lib/contract';
import { withCheckoutLock } from '../lib/locks';
import { appendEnvLog, readStackState } from '../lib/state';
import { readListedStackRuntime, readStack, type StackRead } from '../lib/stack';
import { resetDatabase, startStack } from '../lib/stack-lifecycle';
import { assertOwnWorkdir, assertOwnedStack } from '../lib/ownership';
import { assertNativeAvailable, selectRuntime } from '../lib/platform';
import { excludesFor, PROFILES } from '../profiles';
import { probeCapabilities, probeContextFromStatus } from '../lib/capabilities';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot } from '../lib/snapshot';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitReady(stack: StackRead, timeoutSeconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const context = probeContextFromStatus(stack.status);
  for (;;) {
    if ((await probeCapabilities(PROFILES.full.capabilities, context)).ok) return true;
    if (Date.now() >= deadline) return false;
    await sleep(500);
  }
}

/**
 * `supabase db reset` for this checkout's stack. Refused in shared mode and
 * non-interactive without `--yes`. A named stack is addressed by its remote DB
 * URL (`sslmode=disable` for the plaintext local Postgres) because database
 * commands accept no `--stack`.
 */
export async function runResetDb(parsed: ParsedCommand): Promise<number> {
  const options = parsed.resetDb;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'reset-db options are missing');
  // Ownership first: the reset is destructive and acts on whatever stack the
  // CLI resolves, so a foreign `SUPABASE_WORKDIR` may not reach it.
  assertOwnWorkdir();
  const contract = readContractLenient();
  if (contract.shared) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      [
        'SUPABASE_SHARED=1: refusing to reset a database this checkout does not own.',
        `Run 'bun run env:reset-db --yes' in the owning checkout${contract.sharedOwner ? ` (${contract.sharedOwner})` : ''}.`,
      ].join('\n'),
    );
  }
  const cliStackName = options.stack ?? contract.stackName;

  if (!parsed.yes) {
    if (!(await confirm('Reset this checkout’s database (all local data is deleted)? [y/N] '))) {
      throw new EnvFailure(
        2,
        'refusing to reset the database without confirmation (pass --yes when non-interactive)',
      );
    }
  }

  appendEnvLog(`reset-db: stack=${cliStackName ?? 'default'}`);
  return withCheckoutLock(async () => {
    let stack = readStack(cliStackName);
    if (stack) assertOwnedStack(stack, cliStackName);
    if (!stack) {
      // A stopped stack is started for the reset: `db reset` needs a live
      // database, and the runtime must match the one the stack was created with.
      const persisted = readListedStackRuntime(cliStackName);
      const selection = selectRuntime(null);
      const runtime = (persisted as RuntimeChoice | null) ?? selection.runtime;
      if (runtime === 'native') assertNativeAvailable('full');
      if (runtime !== 'native' && runtime !== 'docker') {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `this stack uses unsupported runtime='${runtime}'; recreate it with --runtime native or docker`,
        );
      }
      const started = startStack({
        stackName: cliStackName,
        runtime,
        excludes: excludesFor(PROFILES.full.capabilities),
        timeoutMs: 360_000,
      });
      if (started.timedOut) {
        throw new EnvFailure(EXIT_TIMEOUT, "'supabase stack start' did not finish within 360s");
      }
      if (!started.ok) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          `failed to start this checkout's stack (${started.stderr.trim() || 'supabase stack start failed'})`,
        );
      }
      stack = readStack(cliStackName);
      if (!stack) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          "the stack started but 'supabase stack status' did not report endpoints",
        );
      }
      assertOwnedStack(stack, cliStackName);
      if (!(await waitReady(stack, 180))) {
        throw new EnvFailure(EXIT_TIMEOUT, 'the stack did not become ready within 180s');
      }
    }

    const result = resetDatabase({ stackName: cliStackName, dbUrl: stack.env.dbUrl });
    if (result.timedOut) {
      throw new EnvFailure(EXIT_TIMEOUT, "'supabase db reset' did not finish within 300s");
    }
    if (!result.ok) {
      throw new EnvFailure(
        EXIT_START_FAILED,
        cliStackName && !stack.env.dbUrl
          ? "could not read this named stack's DB_URL; run 'env:ensure --profile api' first"
          : `'supabase db reset' failed (exit ${result.exitCode ?? 'unknown'})`,
      );
    }

    const state = readStackState();
    const snapshot = await collectSnapshot({
      contract,
      stack: stack.status,
      state,
      skipStackLookup: true,
      supabaseHttp: 200,
      ready: true,
      cold: false,
      profile: state?.profile ?? null,
    });
    if (parsed.json) printJson(snapshot);
    else if (!parsed.quiet) {
      writeStderrLine(
        `env: reset-db complete — stack ${stack.status.id.slice(0, 12)} (data reset)`,
      );
    }
    return 0;
  });
}
