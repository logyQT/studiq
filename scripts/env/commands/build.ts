import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { readContract } from '../lib/contract';
import { applyContractEnv, contractWithLease } from '../lib/contract-lease';
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
import {
  reportBuildFailure,
  runProductionBuild,
  type BuildResult,
  type ProductionBuildOptions,
} from '../lib/build';
import { recoverHandover } from '../lib/rebuild';
import { normalizeLocalhost, trimTrailingSlash } from '../lib/urls';
import { REPO_ROOT } from '../lib/repo';
import { acquireCheckoutLock, withReleasedCheckoutLock } from '../lib/locks';
import type { BuildRunStatus } from '../lib/json';

/**
 * The one I/O seam for this command (and the tests' injection point).
 *
 * Production always uses `runProductionBuild`; the unit tests inject a fake so
 * handover recovery can be proven to run before any real build is attempted.
 */
export interface BuildDeps {
  build(envHash: string, options: ProductionBuildOptions): Promise<BuildResult>;
}

const defaultBuildDeps: BuildDeps = {
  build: (envHash, options) => runProductionBuild(envHash, undefined, options),
};

export async function runBuild(
  parsed: ParsedCommand,
  deps: BuildDeps = defaultBuildDeps,
): Promise<number> {
  const options = parsed.build;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'build options are missing');
  const app = options.app;
  const web = app === 'web';

  // The checkout lock also covers the lease read this build adopts. It is
  // released for the build itself and always taken back (see the build block).
  const lock = await acquireCheckoutLock();
  try {
    // Settle an artifact left behind by an interrupted rebuild before `.next`
    // or the build state is read. An unresolved recovery aborts the build
    // instead of building over (or reporting) an unproven artifact; a record
    // owned by a live process is an in-flight rebuild of the same artifact.
    // The handover describes `apps/web/.next`, so an admin build never touches it.
    if (web) {
      const recovery = recoverHandover();
      if (recovery.status === 'in-flight') {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `another env process (pid ${recovery.ownerPid}) is rebuilding apps/web/.next; retry once its build handover settles`,
        );
      }
    }

    const appEnv = resolveLocalAppEnv();
    // Select the requested stack before resolving its lease, so lease-derived
    // URLs/ports belong to the stack this build is actually for.
    const base = readContract();
    const contract = contractWithLease({
      ...base,
      stackName: options.stack ?? base.stackName,
    });
    applyContractEnv(contract);
    appendEnvLog(
      `build: app=${app} admission=${options.admission} shared=${contract.shared} force=${options.force}`,
    );

    const state = readStackState();
    // A running web server owns `apps/web/.next` and nothing else: it neither
    // blocks nor is disturbed by an `apps/admin` build, which serves on 4000.
    if (web) {
      const conflict = liveServerConflict(
        { stackName: contract.stackName ?? 'default', profile: state?.profile ?? null },
        'rebuild',
      );
      if (conflict) return refuseConflict(parsed, contract, conflict);
    }

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
    // The fingerprint and `.dev/build.json` describe `apps/web`'s artifact. Admin
    // has no fingerprint of its own (ADR-0014, decision 6), so it always builds.
    const previous = web ? readBuildState() : null;
    const current =
      web &&
      previous?.envHash === envHash &&
      previous.fingerprint ===
        computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash }) &&
      buildArtifactPresent();
    const built = !current || options.force;

    let result: BuildResult | null = null;
    let builtAt: string | null = previous?.builtAt ?? null;
    if (built) {
      if (web && readWebPid()) {
        throw new EnvFailure(EXIT_CONFLICT, "the web server is running; run 'env:down' first");
      }
      // Lock ordering: checkout lock → release → worktree mutex → slot → build
      // → release both → checkout lock. The slot wait can last 30 minutes, and
      // `env:down` needs this lock, so the build never holds it while it queues.
      // The per-worktree mutex inside `runProductionBuild` is what keeps a second
      // build out of this `.next`, so releasing the lock cannot admit one.
      result = await withReleasedCheckoutLock(
        lock,
        () => deps.build(envHash, { app, admission: options.admission }),
        'build returned no result',
      );
      // The lock was free for the build, so another env process may have started
      // a server over the artifact this build just replaced. That artifact is not
      // current for a serving environment, so it is reported, not recorded.
      if (web && result.ok && readWebPid()) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          "a web server started during the build; run 'env:down' and retry",
        );
      }
      if (!result.ok) {
        const failure = reportBuildFailure(result, app);
        throw new EnvFailure(failure.code, failure.message);
      }
      // `--no-lock` never records: a bypassed artifact is not reported as
      // current by construction (ADR-0014, decision 6).
      builtAt = new Date().toISOString();
      if (web && options.admission !== 'no-lock') {
        writeBuildState({
          fingerprint: result.fingerprintAfter,
          envHash,
          builtAt,
        });
      }
    }

    const snapshot = await collectSnapshot({
      contract,
      stack: stack?.status ?? null,
      state,
      skipStackLookup: true,
      profile: state?.profile ?? null,
      cold: state?.cold ?? null,
    });
    const buildRun: BuildRunStatus = {
      app,
      admission: options.admission,
      slot: result?.slot ?? null,
      grant: result?.grant ?? 'unconsumed',
      built,
      ok: result?.ok ?? true,
      fingerprint: web ? (result?.fingerprintAfter ?? previous?.fingerprint ?? null) : null,
      builtAt,
    };
    if (parsed.json) printJson({ ...snapshot, buildRun });
    // A build that ran already printed its own finish line (with the duration)
    // from `runProductionBuild`; only the no-op case is this command's to report.
    else if (!built) writeStderrLine('Build is already current.');
    return 0;
  } finally {
    await lock.release();
  }
}
