import { UsageError, type DownOptions, type ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { readContractLenient, readStackName } from '../lib/contract';
import { appendEnvLog, identityKey, readStackState, removeStackState } from '../lib/state';
import { removeCachedStack } from '../lib/stack-cache';
import { ensureRegistryDir, pidAlive, withCheckoutLock } from '../lib/locks';
import { leaseProjectId, readLease, releaseProjectClaims, removeLease } from '../lib/lease';
import { REPO_ROOT, isThisCheckout, currentBranchRef } from '../lib/repo';
import { readStackList, readStackStatus, stackAbsenceConfirmed } from '../lib/stack';
import { stopStack } from '../lib/stack-lifecycle';
import { stopWebServer, type StopWebResult } from '../lib/web';
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

/** The process facts `down` needs about this checkout's server. */
export interface DownWebGuard {
  stop(): StopWebResult;
  /** Liveness re-check for the PID the stop attempt recorded. */
  alive(pid: number): boolean;
}

const defaultDownWebGuard: DownWebGuard = {
  stop: stopWebServer,
  alive: pidAlive,
};

interface WebStop {
  /** The line describing the stop attempt. */
  line: string;
  /** The recorded PID that is still alive after the stop, or null. */
  survivor: number | null;
}

/**
 * Stop this checkout's server and keep the outcome available to the terminal
 * branches. `stopWebServer` already declines a stop it cannot prove; the
 * liveness re-check here catches a recorded PID that outlived it, so no
 * terminal branch can publish a stopped state over a survivor.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function stopWebForDown(guard: DownWebGuard = defaultDownWebGuard): WebStop {
  const result = guard.stop();
  const survivor = result.pid !== null && guard.alive(result.pid) ? result.pid : null;
  const line = result.stopped
    ? `Stopped this checkout's web server (pid ${result.pid})`
    : result.pid !== null
      ? `Web pid ${result.pid} could not be stopped; leaving it.`
      : 'Web server is not running in this checkout.';
  return { line, survivor };
}

/**
 * A terminal `down` state must never be published over a live web server: the
 * lease, its app-port claim and the stack attribution stay exactly as they are,
 * and the exit code says the teardown did not finish.
 */
function refuseOverWebSurvivor(web: WebStop): void {
  if (web.survivor === null) return;
  throw new EnvFailure(
    EXIT_CONFLICT,
    `web server (pid ${web.survivor}) is still running; kept the app-port lease and stack records. Stop it and retry.`,
  );
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

export async function runDown(
  parsed: ParsedCommand,
  webGuard: DownWebGuard = defaultDownWebGuard,
): Promise<number> {
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
    const web = stopWebForDown(webGuard);
    const lines = [web.line];
    if (contract.shared) {
      // The stop outcome decides the terminal state: a live server still owns
      // the leased port, so the lease and its attribution must survive.
      refuseOverWebSurvivor(web);
      releaseLease(dir, projectId);
      removeStackState();
      removeCachedStack();
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
      // A null status alone proves nothing: only a readable list without this
      // checkout's still-running entry confirms the stack is gone.
      if (!stack && stackAbsenceConfirmed(cliStackName || 'default')) {
        refuseOverWebSurvivor(web);
        releaseLease(dir, projectId);
        removeStackState();
        removeCachedStack();
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
      // Plain `down` over a live stack keeps the lease anyway and reports the
      // survivor above; there is no cleanup left that it could publish.
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
      // A failed stop is only forgiven when the list proves the stack is gone:
      // a null `readStackStatus` can equally mean the CLI could not be read.
      if (!result.ok && !stackAbsenceConfirmed(wanted)) {
        throw new EnvFailure(EXIT_START_FAILED, 'stack stop failed; keeping the lease');
      }
      lines.push(`Stopped Supabase stack '${wanted}' (data kept).`);
    } else lines.push('Supabase stack is already stopped.');
    // The stack is down, but a surviving server still owns the leased port:
    // keep every record so it can be stopped and the port reclaimed later.
    refuseOverWebSurvivor(web);
    releaseLease(dir, projectId);
    removeStackState();
    removeCachedStack();
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
