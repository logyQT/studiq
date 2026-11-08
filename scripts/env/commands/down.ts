import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { readContractLenient } from '../lib/contract';
import { appendEnvLog, identityKey, readStackRecord, removeStackRecord } from '../lib/state';
import { acquireStartLock, ensureRegistryDir, withCheckoutWebLock } from '../lib/locks';
import { leaseProjectId, readLease, removeLease } from '../lib/lease';
import { REPO_ROOT, isThisCheckout, currentBranchRef } from '../lib/repo';
import { readStackList, readStackStatus } from '../lib/stack';
import { stopStack } from '../lib/stack-lifecycle';
import { stopWebServer } from '../lib/web';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot, stateKeyFor } from '../lib/snapshot';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function human(parsed: ParsedCommand, lines: string[]): void {
  if (parsed.json) return;
  if (parsed.quiet) return;
  for (const line of lines) writeStderrLine(line);
}

function webStopLine(): string {
  const webStop = stopWebServer();
  return webStop.stopped
    ? `Stopped this checkout's web server (pid ${webStop.pid})`
    : webStop.pid
      ? `Web pid ${webStop.pid} does not belong to this checkout (or could not be signalled); leaving it.`
      : 'Web server is not running in this checkout.';
}

/**
 * `down` and `ensure` mutate the same stack. Take the per-identity start lock
 * (the one `ensure` holds through its final probe/state write) before reading
 * status, stopping web/stack or removing state, so a stop cannot race a start.
 */
async function acquireDownLock(input: {
  key: string;
  branch: string;
  cliStackName: string | null;
}) {
  try {
    return await acquireStartLock({
      key: input.key,
      projectRoot: REPO_ROOT,
      branch: input.branch,
      stackName: input.cliStackName ?? '',
      waitSeconds: 60,
    });
  } catch (error) {
    if (error instanceof EnvFailure && error.exitCode === EXIT_TIMEOUT) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        'cannot run env:down while env:ensure is still starting/serving this stack; retry after it finishes (or inspect it with env:status)',
      );
    }
    throw error;
  }
}

export async function runDown(parsed: ParsedCommand): Promise<number> {
  const options = parsed.down;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'down options are missing');
  const contract = readContractLenient();
  const branch = currentBranchRef();
  const cliStackName = options.stack ?? contract.stackName;
  const snapshotContract = { ...contract, stackName: cliStackName };
  const key = identityKey(REPO_ROOT, branch, cliStackName ?? '');
  const dir = ensureRegistryDir();
  const projectId = leaseProjectId(key);
  appendEnvLog(`down: all=${options.all} shared=${contract.shared}`);

  if (options.all && contract.shared) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      [
        'SUPABASE_SHARED=1: refusing to stop a stack this checkout does not own.',
        `Run 'env:down --all' in the owning checkout${contract.sharedOwner ? ` (${contract.sharedOwner})` : ''}.`,
        "Use 'env:down' (no --all) to stop only this checkout's web server.",
      ].join('\n'),
    );
  }

  if (options.all && !parsed.yes) {
    if (!(await confirm(`Stop this checkout's Supabase stack (data is kept)? [y/N] `))) {
      throw new EnvFailure(
        2,
        'refusing to stop the stack without confirmation (pass --yes when non-interactive)',
      );
    }
  }

  if (contract.shared) {
    // This checkout owns only its web server. The shared stack's auth URLs are
    // bound to the *owner's* APP_URL, so this checkout's lease protects nothing;
    // release it with the record.
    return withCheckoutWebLock(async () => {
      const lines = [webStopLine()];
      const lease = readLease(dir, projectId);
      removeLease(dir, projectId);
      removeStackRecord(stateKeyFor(cliStackName));
      if (lease) lines.push(`Released the app-port lease on ${lease.appPort} (shared stack).`);
      human(parsed, lines);
      if (parsed.json) {
        const snapshot = await collectSnapshot({
          contract: snapshotContract,
          stack: null,
          record: null,
          skipStackLookup: true,
        });
        printJson(snapshot);
      }
      return 0;
    });
  }

  const lock = await acquireDownLock({ key, branch, cliStackName });
  try {
    return await withCheckoutWebLock(async () => {
      const lines: string[] = [webStopLine()];
      if (!options.all) {
        const stack = readStackStatus(cliStackName);
        const listed = readStackList();
        const wantedName = cliStackName || 'default';
        const listedOurs = (listed ?? []).find(
          (entry) =>
            isThisCheckout(entry.projectRoot) &&
            (entry.name || 'default') === wantedName &&
            (entry.branch ?? '') === branch,
        );
        const stackRunning = Boolean(stack) || listedOurs?.owner === 'reachable';
        const lease = readLease(dir, projectId);
        if (!stackRunning && listed !== null && lease) {
          // A stopped stack does not need its app-port lease; release it exactly once.
          removeLease(dir, projectId);
          removeStackRecord(stateKeyFor(cliStackName));
          lines.push('Released the app-port lease (stack is stopped).');
        } else if (lease) {
          lines.push(`Kept the app-port lease on ${lease.appPort} while the stack runs.`);
        }
        human(parsed, lines);
        if (parsed.json) {
          const snapshot = await collectSnapshot({
            contract: snapshotContract,
            stack,
            record: readStackRecord(stateKeyFor(cliStackName)),
          });
          printJson(snapshot);
        }
        return 0;
      }

      // `down --all`: stop only a stack whose project_root is this checkout.
      const stack = readStackStatus(cliStackName);
      const listed = readStackList();
      const wantedName = cliStackName || 'default';
      const listedOurs = (listed ?? []).find(
        (entry) =>
          isThisCheckout(entry.projectRoot) &&
          (entry.name || 'default') === wantedName &&
          (entry.branch ?? '') === branch,
      );
      const foreign = listed?.find(
        (entry) =>
          entry.name === wantedName &&
          !isThisCheckout(entry.projectRoot) &&
          (entry.branch ?? '') === branch,
      );
      if (foreign && !listedOurs) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `stack '${wantedName}' is owned by ${foreign.projectRoot}; refusing to stop it`,
        );
      }
      if (stack && stack.projectRoot && !isThisCheckout(stack.projectRoot)) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `stack ${stack.id.slice(0, 12)} belongs to ${stack.projectRoot}, not this checkout; refusing to stop it`,
        );
      }

      if (!stack && listed === null) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          "cannot read 'supabase stack list' to verify ownership; refusing to guess whether this stack is stopped",
        );
      }
      const shouldStop = Boolean(stack) || Boolean(listedOurs);
      if (shouldStop) {
        const result = stopStack(cliStackName);
        if (!result.ok) {
          // A failed stop is not proof the stack is gone. Confirm with status *and*
          // the stack list (canonical project root + name) before releasing the
          // lease; if either cannot confirm a stop, keep the lease and fail.
          const after = readStackStatus(cliStackName);
          const afterList = readStackList();
          const stillListedRunning = (afterList ?? []).some(
            (entry) =>
              isThisCheckout(entry.projectRoot) &&
              (entry.name || 'default') === wantedName &&
              (entry.branch ?? '') === branch &&
              entry.owner === 'reachable',
          );
          const confirmedStopped =
            after?.lifecycle === 'stopped' ||
            (afterList !== null && !stillListedRunning && after?.lifecycle !== 'running');
          if (after?.lifecycle === 'running' || stillListedRunning || !confirmedStopped) {
            throw new EnvFailure(
              EXIT_START_FAILED,
              `could not stop this checkout's stack (${result.stderr.trim() || 'stack stop failed'}); keeping the app-port lease`,
            );
          }
        }
        lines.push(
          `Stopped Supabase stack '${stack?.name ?? listedOurs?.name ?? wantedName}' (data kept).`,
        );
      } else {
        lines.push('Supabase stack is already stopped.');
      }

      removeLease(dir, projectId);
      removeStackRecord(stateKeyFor(cliStackName));
      lines.push('Released the app-port lease.');
      human(parsed, lines);

      if (parsed.json) {
        const snapshot = await collectSnapshot({
          contract: snapshotContract,
          stack: readStackStatus(cliStackName),
          record: readStackRecord(stateKeyFor(cliStackName)),
        });
        printJson(snapshot);
      }
      appendEnvLog('down: complete');
      return 0;
    });
  } finally {
    lock.release();
  }
}
