import { UsageError, type DownOptions, type ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { readContractLenient, readStackName } from '../lib/contract';
import { appendEnvLog, identityKey, readStackState, removeStackState } from '../lib/state';
import { ensureRegistryDir, withCheckoutLock } from '../lib/locks';
import { leaseProjectId, readLease, releaseProjectClaims, removeLease } from '../lib/lease';
import { REPO_ROOT, isThisCheckout, currentBranchRef } from '../lib/repo';
import { readStackList, readStackStatus } from '../lib/stack';
import { stopStack } from '../lib/stack-lifecycle';
import { stopWebServer } from '../lib/web';
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

function webStopLine(): string {
  const result = stopWebServer();
  return result.stopped
    ? `Stopped this checkout's web server (pid ${result.pid})`
    : result.pid
      ? `Web pid ${result.pid} could not be stopped; leaving it.`
      : 'Web server is not running in this checkout.';
}

/** Drop the app-port lease **and** its cross-checkout claim together. */
function releaseLease(dir: string, projectId: string): void {
  removeLease(dir, projectId);
  releaseProjectClaims(dir, projectId);
}

/**
 * The stack `down` acts on.
 *
 * `readContractLenient` folds a malformed `SUPABASE_STACK` to null so reporting
 * and plain `down` never break, but `down --all` actually stops a stack: an
 * invalid name must surface as a usage error (exit 2) instead of silently
 * stopping the default one. An explicit `--stack` is already validated by the
 * parser and always wins.
 */
function downStackName(options: DownOptions, lenientName: string | null): string | null {
  if (options.stack) return options.stack;
  if (!options.all) return lenientName;
  try {
    return readStackName();
  } catch (error) {
    if (error instanceof UsageError) {
      throw new UsageError(`${error.message} Refusing 'down --all' without an explicit --stack.`);
    }
    throw error;
  }
}

export async function runDown(parsed: ParsedCommand): Promise<number> {
  const options = parsed.down;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'down options are missing');
  const contract = readContractLenient();

  if (options.all && contract.shared) {
    throw new EnvFailure(EXIT_CONFLICT, 'SUPABASE_SHARED=1: refusing to stop a foreign stack');
  }

  const cliStackName = downStackName(options, contract.stackName);
  const snapshotContract = { ...contract, stackName: cliStackName };
  const branch = currentBranchRef();
  const projectId = leaseProjectId(identityKey(REPO_ROOT, branch, cliStackName ?? ''));
  const dir = ensureRegistryDir();
  appendEnvLog(`down: all=${options.all} stack=${cliStackName ?? 'default'}`);

  if (options.all && !parsed.yes && !(await confirm("Stop this checkout's stack? [y/N] "))) {
    throw new EnvFailure(2, 'refusing to stop without confirmation (pass --yes)');
  }

  return withCheckoutLock(async () => {
    const lines = [webStopLine()];
    if (contract.shared) {
      releaseLease(dir, projectId);
      removeStackState();
      lines.push('Released the app-port lease (shared stack).');
      if (parsed.json) {
        printJson(
          await collectSnapshot({
            contract: snapshotContract,
            stack: null,
            state: null,
            skipStackLookup: true,
          }),
        );
      } else for (const line of lines) writeStderrLine(line);
      return 0;
    }

    const stack = readStackStatus(cliStackName);
    if (!options.all) {
      if (!stack && readStackList() !== null) {
        releaseLease(dir, projectId);
        removeStackState();
        lines.push('Released the app-port lease (stack is stopped).');
      } else {
        const lease = readLease(dir, projectId);
        if (lease) lines.push(`Kept the app-port lease on ${lease.appPort}.`);
      }
      if (parsed.json) {
        printJson(
          await collectSnapshot({ contract: snapshotContract, stack, state: readStackState() }),
        );
      } else for (const line of lines) writeStderrLine(line);
      return 0;
    }

    const listed = readStackList();
    const wanted = cliStackName || 'default';
    const ours = (listed ?? []).find(
      (entry) => isThisCheckout(entry.projectRoot) && (entry.name || 'default') === wanted,
    );
    const foreign = listed?.find(
      (entry) => entry.name === wanted && !isThisCheckout(entry.projectRoot),
    );
    if (foreign && !ours) {
      throw new EnvFailure(EXIT_CONFLICT, `stack '${wanted}' belongs to ${foreign.projectRoot}`);
    }
    if (stack && stack.projectRoot && !isThisCheckout(stack.projectRoot)) {
      throw new EnvFailure(EXIT_CONFLICT, `stack '${wanted}' belongs to another checkout`);
    }
    if (!stack && listed === null) {
      throw new EnvFailure(EXIT_START_FAILED, 'cannot read stack list; not stopping anything');
    }
    if (stack || ours) {
      const result = stopStack(cliStackName);
      if (!result.ok && readStackStatus(cliStackName)) {
        throw new EnvFailure(EXIT_START_FAILED, 'stack stop failed; keeping the lease');
      }
      lines.push(`Stopped Supabase stack '${wanted}' (data kept).`);
    } else lines.push('Supabase stack is already stopped.');
    releaseLease(dir, projectId);
    removeStackState();
    lines.push('Released the app-port lease.');
    if (parsed.json) {
      printJson(
        await collectSnapshot({
          contract: snapshotContract,
          stack: readStackStatus(cliStackName),
          state: null,
        }),
      );
    } else for (const line of lines) writeStderrLine(line);
    appendEnvLog('down: complete');
    return 0;
  });
}
