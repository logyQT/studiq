import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { appPortSource, readContract } from '../lib/contract';
import { applyContractEnv, contractWithLease } from '../lib/contract-lease';
import { buildInProgress, buildInProgressFailure, withCheckoutLock } from '../lib/locks';
import { readStack } from '../lib/stack';
import { applyStackEnv } from '../lib/stack-lifecycle';
import { assertOwnWorkdir, assertOwnedStack } from '../lib/ownership';
import {
  identityKey,
  appendEnvLog,
  artifactStateLabel,
  classifyBuildArtifact,
  readStackState,
} from '../lib/state';
import { leaseProjectId, readLease, touchLease, writeLease } from '../lib/lease';
import { readRegistry } from '../lib/registry';
import { currentBranchRef, REPO_ROOT } from '../lib/repo';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import {
  readWebPid,
  recordedWebReadiness,
  startWebServer,
  stopWebServer,
  waitForWeb,
  webLogPath,
} from '../lib/web';
import { probeHttp } from '../lib/health';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot } from '../lib/snapshot';
import {
  writeEnvManifest,
  sharedStackFacts,
  stackFacts,
  stoppedStackFacts,
  type ManifestStack,
} from '../lib/manifest';
import { liveServerConflict } from '../lib/web-owner';
import { refuseConflict } from '../lib/refusal';
import { resolveLocalAppEnv, sharedStackEnv } from '../lib/app-env';
import { recoverHandover } from '../lib/rebuild';

const healthy = (code: number) => code >= 200 && code < 400;

/**
 * Refuse while a build owns this worktree's `.next`.
 *
 * `checkout.lock` is free for the build and the fingerprint describes the source
 * tree, so the per-worktree mutex is the only fact that says the artifact is
 * being written. Called at each point where the answer can have changed since the
 * previous read: before the stack is resolved, before the artifact is judged, and
 * immediately before the server is spawned.
 */
function refuseBuildInProgress(): void {
  const build = buildInProgress();
  if (build) throw buildInProgressFailure(build);
}

/**
 * Serve an existing production build. Unlike `ensure`, this never starts or
 * changes the Supabase stack: it refuses when no stack is running or the build
 * fingerprint is stale, naming the command that fixes it. It shares `ensure`'s
 * app-port lease, second-server refusal and checkout-wide lock.
 */
export async function runServe(parsed: ParsedCommand): Promise<number> {
  const options = parsed.serve;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'serve options are missing');
  const appEnv = resolveLocalAppEnv();
  // A foreign `SUPABASE_WORKDIR` (or a named stack it resolves to) would make
  // this serve another checkout's URL and keys; refuse before any read.
  assertOwnWorkdir();

  return withCheckoutLock(async () => {
    // Settle an artifact left behind by an interrupted rebuild before `.next`
    // or the build state is read, exactly like `env:build`: a restored `.next`
    // must never inherit the interrupted run's "this build is current" claim.
    // A record owned by a live process is that process's in-flight rebuild (the
    // checkout lock is free for it), so refuse rather than serve its artifact.
    const recovery = recoverHandover();
    if (recovery.status === 'in-flight') {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `another env process (pid ${recovery.ownerPid}) is rebuilding apps/web/.next; retry once its build handover settles`,
      );
    }

    // A build owns `.next` for its whole run and `checkout.lock` is deliberately
    // free for it, so the build record and the fingerprint cannot tell that the
    // artifact is half-written. Starting a server here would serve it. This early
    // read is the cheap refusal; it is not the invariant — a build that takes its
    // mutex while this command is still resolving the stack is only visible to
    // the re-reads below.
    refuseBuildInProgress();

    const base = readContract();
    const stackName = options.stack ?? base.stackName;
    const contract = contractWithLease({ ...base, stackName });
    const projectId = leaseProjectId(identityKey(REPO_ROOT, currentBranchRef(), stackName ?? ''));
    const lease = readLease(readRegistry().dir, projectId);
    // Resolved here, before `applyContractEnv` writes APP_PORT/APP_URL for the
    // child: afterwards only the value survives, not which input named it.
    const portSource = appPortSource(contract.appPort, lease?.appPort ?? null);
    applyContractEnv(contract);
    appendEnvLog(`serve: stack=${stackName ?? 'default'} shared=${contract.shared}`);

    // The stack facts this run proves, so a refusal after a mutation still
    // publishes what it learned. Undefined means "not proved" — the writer then
    // derives a claim from `.dev/stack.json`, which `status` reconciles.
    let manifestStack: ManifestStack | undefined;
    try {
      const state = readStackState();
      const conflict = liveServerConflict(
        { stackName: stackName ?? 'default', profile: state?.profile ?? 'web' },
        'start',
      );
      if (conflict) return refuseConflict(parsed, contract, conflict);

      const stack = contract.shared ? null : readStack(stackName);
      if (!contract.shared && !stack) {
        manifestStack = stoppedStackFacts();
        throw new EnvFailure(
          EXIT_START_FAILED,
          "no running Supabase stack for this checkout; run 'env:ensure --profile api' first",
        );
      }
      if (stack) {
        assertOwnedStack(stack, stackName);
        manifestStack = stackFacts(stack.status);
      } else {
        manifestStack = sharedStackFacts();
      }
      const stackEnv = contract.shared ? sharedStackEnv() : stack!.env;
      if (contract.shared) {
        const missing = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(
          (name) => !process.env[name],
        );
        if (missing.length > 0) {
          throw new EnvFailure(
            EXIT_START_FAILED,
            `SUPABASE_SHARED=1 needs ${missing.join(', ')} in .env.local (or the process environment)`,
          );
        }
        if ((await probeHttp(`${stackEnv.apiUrl}/auth/v1/health`)) !== 200) {
          throw new EnvFailure(EXIT_START_FAILED, 'the shared Supabase stack is not healthy');
        }
      }
      applyStackEnv(stackEnv, {
        appUrl: contract.appUrl,
        appEnv,
        stackId: stack?.status.id,
      });

      const envHash = buildEnvHash({
        supabaseUrl: stackEnv.apiUrl,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
        anonKey: stackEnv.anonKey ?? '',
      });
      let webPid = readWebPid();
      let webHttp = await probeHttp(contract.appUrl);
      if (healthy(webHttp)) {
        const readiness = recordedWebReadiness(contract.appPort);
        if (!readiness.ready) {
          throw new EnvFailure(
            EXIT_CONFLICT,
            `${contract.appUrl} answers but is not this checkout's server on ${portSource}; run 'env:down' first`,
          );
        }
      } else {
        // The stack read above takes hundreds of milliseconds, and the build takes
        // its mutex only after releasing the checkout lock this command waited on.
        // This is the check that decides: it must name the build, not report the
        // artifact the build is rewriting as missing.
        refuseBuildInProgress();
        const previous = readWebPid();
        if (previous !== null) stopWebServer();
        const built = computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash });
        // A fingerprint match is not enough: the artifact must also be the one
        // `.dev/build.json` describes, and a raw `next build` (or a `--no-lock`
        // one) moves `BUILD_ID` past that record. Only `current` may be served.
        const state = classifyBuildArtifact({ fingerprint: built, envHash });
        if (state !== 'current') {
          throw new EnvFailure(
            EXIT_START_FAILED,
            `no current production build for this stack — ${artifactStateLabel(state)}; run 'bun run env:build' (or 'env:ensure --profile web')`,
          );
        }
        // Fingerprinting the tree takes long enough for a build to start, so the
        // mutex is read once more at the point of no return.
        refuseBuildInProgress();
        webPid = startWebServer({
          appPort: contract.appPort,
          appUrl: contract.appUrl,
          env: process.env,
        });
        if (lease) writeLease(touchLease(lease, { appPort: contract.appPort, ownerPid: webPid }));
        const waited = await waitForWeb(contract.appUrl, webPid, 120, contract.appPort);
        webHttp = waited.http;
        if (!waited.ok) {
          stopWebServer();
          throw new EnvFailure(
            EXIT_START_FAILED,
            `web did not become healthy on ${contract.appUrl} (${waited.reason}); see ${webLogPath()}`,
          );
        }
      }

      const snapshot = await collectSnapshot({
        contract,
        stack: stack?.status ?? null,
        state,
        skipStackLookup: true,
        web: { pid: webPid, http: webHttp },
        supabaseHttp: 200,
        ready: true,
        profile: state?.profile ?? 'web',
        cold: false,
      });
      if (parsed.json) printJson(snapshot);
      else if (!parsed.quiet) {
        writeStderrLine(`env: serve ready — ${contract.appUrl} (pid ${webPid ?? '-'})`);
        writeStderrLine('  log      .dev/web.log');
      }
      return 0;
    } finally {
      // Every exit after the contract is resolved republishes the file: a
      // refusal, a stopped server whose artifact turned out unservable, a start
      // that never became healthy. `serving` is re-derived from `readWebPid()`,
      // so it cannot keep naming the pid this command stopped.
      writeEnvManifest({ contract, stack: manifestStack });
    }
  });
}
