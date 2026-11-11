import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { probeHttp } from '../lib/health';
import { readStack } from '../lib/stack';
import { applyStackEnv } from '../lib/stack-lifecycle';
import { readWebPid } from '../lib/web';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot } from '../lib/snapshot';
import { liveServerConflict } from '../lib/web-owner';
import { refuseConflict } from '../lib/refusal';
import { resolveLocalAppEnv, sharedStackEnv } from '../lib/app-env';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import {
  appendEnvLog,
  buildArtifactPresent,
  readBuildState,
  readStackState,
  writeBuildState,
} from '../lib/state';
import { logBuildOutput, runProductionBuild, type BuildResult } from '../lib/build';
import { recoverHandover } from '../lib/rebuild';
import { normalizeLocalhost, trimTrailingSlash } from '../lib/urls';
import { REPO_ROOT } from '../lib/repo';
import { withCheckoutLock } from '../lib/locks';

/**
 * The one I/O seam for this command (and the tests' injection point).
 *
 * Production always uses `runProductionBuild`; the unit tests inject a fake so
 * handover recovery can be proven to run before any real build is attempted.
 */
export interface BuildDeps {
  build(envHash: string): Promise<BuildResult>;
}

const defaultBuildDeps: BuildDeps = { build: runProductionBuild };

export async function runBuild(
  parsed: ParsedCommand,
  deps: BuildDeps = defaultBuildDeps,
): Promise<number> {
  const options = parsed.build;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'build options are missing');

  // The checkout lock also covers the lease read this build adopts.
  return withCheckoutLock(async () => {
    // Settle an artifact left behind by an interrupted rebuild before `.next`
    // or the build state is read. An unresolved recovery aborts the build
    // instead of building over (or reporting) an unproven artifact; a record
    // owned by a live process is an in-flight rebuild of the same artifact.
    const recovery = recoverHandover();
    if (recovery.status === 'in-flight') {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `another env process (pid ${recovery.ownerPid}) is rebuilding apps/web/.next; retry once its build handover settles`,
      );
    }

    const appEnv = resolveLocalAppEnv();
    // Select the requested stack before resolving its lease, so lease-derived
    // URLs/ports belong to the stack this build is actually for.
    const base = readContract();
    const contract = contractWithLease({
      ...base,
      stackName: options.stack ?? base.stackName,
    });
    process.env.APP_PORT = String(contract.appPort);
    process.env.APP_URL = contract.appUrl;
    process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;
    appendEnvLog(`build: shared=${contract.shared} force=${options.force}`);

    const state = readStackState();
    const conflict = liveServerConflict(
      { stackName: contract.stackName ?? 'default', profile: state?.profile ?? null },
      'rebuild',
    );
    if (conflict) return refuseConflict(parsed, contract, conflict);

    const stack = contract.shared ? null : readStack(contract.stackName);
    if (!contract.shared && !stack) {
      throw new EnvFailure(EXIT_START_FAILED, 'no running Supabase stack; run env:ensure first');
    }
    const stackEnv = contract.shared ? sharedStackEnv() : stack!.env;
    if (contract.shared && !stackEnv.apiUrl) {
      throw new EnvFailure(EXIT_START_FAILED, 'SUPABASE_SHARED=1 needs SUPABASE_URL and keys');
    }
    if (
      contract.shared &&
      (await probeHttp(
        `${normalizeLocalhost(trimTrailingSlash(stackEnv.apiUrl))}/auth/v1/health`,
      )) !== 200
    ) {
      throw new EnvFailure(EXIT_START_FAILED, 'shared Supabase stack is not healthy');
    }
    applyStackEnv(stackEnv, { appUrl: contract.appUrl, appEnv, stackId: stack?.status.id });

    const envHash = buildEnvHash({
      supabaseUrl: stackEnv.apiUrl,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
      anonKey: stackEnv.anonKey ?? '',
    });
    const previous = readBuildState();
    const current =
      previous?.envHash === envHash &&
      previous.fingerprint ===
        computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash }) &&
      buildArtifactPresent();

    if (options.force || !current) {
      if (readWebPid()) {
        throw new EnvFailure(EXIT_CONFLICT, "the web server is running; run 'env:down' first");
      }
      const result = await deps.build(envHash);
      if (!result.ok) {
        logBuildOutput(result.output);
        throw new EnvFailure(
          result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED,
          result.timedOut ? 'timed out waiting for the build lock' : 'build failed',
        );
      }
      writeBuildState({
        fingerprint: result.fingerprintAfter,
        envHash,
        builtAt: new Date().toISOString(),
      });
    }

    const snapshot = await collectSnapshot({
      contract,
      stack: stack?.status ?? null,
      state,
      skipStackLookup: true,
      profile: state?.profile ?? null,
      cold: state?.cold ?? null,
    });
    if (parsed.json) printJson(snapshot);
    else
      writeStderrLine(options.force || !current ? 'Build complete.' : 'Build is already current.');
    return 0;
  });
}
