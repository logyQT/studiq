import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { withCheckoutLock } from '../lib/locks';
import { readStack } from '../lib/stack';
import { applyStackEnv } from '../lib/stack-lifecycle';
import { assertOwnWorkdir, assertOwnedStack } from '../lib/ownership';
import {
  identityKey,
  appendEnvLog,
  buildArtifactPresent,
  readBuildState,
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
import { liveServerConflict } from '../lib/web-owner';
import { refuseConflict } from '../lib/refusal';
import { resolveLocalAppEnv, sharedStackEnv } from '../lib/app-env';
import { recoverHandover } from '../lib/rebuild';

const healthy = (code: number) => code >= 200 && code < 400;

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

    const base = readContract();
    const stackName = options.stack ?? base.stackName;
    const contract = contractWithLease({ ...base, stackName });
    process.env.APP_PORT = String(contract.appPort);
    process.env.APP_URL = contract.appUrl;
    process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;
    appendEnvLog(`serve: stack=${stackName ?? 'default'} shared=${contract.shared}`);

    const state = readStackState();
    const conflict = liveServerConflict(
      { stackName: stackName ?? 'default', profile: state?.profile ?? 'web' },
      'start',
    );
    if (conflict) return refuseConflict(parsed, contract, conflict);

    const stack = contract.shared ? null : readStack(stackName);
    if (!contract.shared && !stack) {
      throw new EnvFailure(
        EXIT_START_FAILED,
        "no running Supabase stack for this checkout; run 'env:ensure --profile api' first",
      );
    }
    if (stack) assertOwnedStack(stack, stackName);
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
    const projectId = leaseProjectId(identityKey(REPO_ROOT, currentBranchRef(), stackName ?? ''));
    const lease = readLease(readRegistry().dir, projectId);

    let webPid = readWebPid();
    let webHttp = await probeHttp(contract.appUrl);
    if (healthy(webHttp)) {
      const readiness = recordedWebReadiness(contract.appPort);
      if (!readiness.ready) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `${contract.appUrl} answers but is not this checkout's server on the leased port; run 'env:down' first`,
        );
      }
    } else {
      const previous = readWebPid();
      if (previous !== null) stopWebServer();
      const built = computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash });
      const recorded = readBuildState();
      if (!buildArtifactPresent() || recorded?.fingerprint !== built) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          "no current production build for this stack; run 'bun run env:build' (or 'env:ensure --profile web')",
        );
      }
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
  });
}
