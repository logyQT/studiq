import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { readContract } from '../lib/contract';
import { applyContractEnv, contractWithLease } from '../lib/contract-lease';
import { probeHttp } from '../lib/health';
import { readStack } from '../lib/stack';
import { applyStackEnv } from '../lib/stack-lifecycle';
import { readWebPid } from '../lib/web';
import {
  writeEnvManifest,
  sharedStackFacts,
  stackFacts,
  type ManifestStack,
} from '../lib/manifest';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot } from '../lib/snapshot';
import { liveServerConflict } from '../lib/web-owner';
import { refuseConflict } from '../lib/refusal';
import { resolveLocalAppEnv, sharedStackEnv } from '../lib/app-env';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import {
  appendEnvLog,
  buildArtifactPresent,
  classifyBuildArtifact,
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
import {
  acquireCheckoutLock,
  buildInProgress,
  withReleasedCheckoutLock,
  withSnapshotLock,
  type CheckoutLock,
} from '../lib/locks';
import {
  collectIdentityFacts,
  publishSnapshot,
  readPublishGates,
  readPublishRecord,
  resolveCacheDir,
  seedWorktreeCache,
  stageSnapshot,
  staticProducerReason,
  type PublishResult,
} from '../lib/build-cache';
import type { BuildApp } from '../lib/grant';
import type { BuildRunStatus, SeedRunStatus, SnapshotRunStatus } from '../lib/json';

/**
 * The one I/O seam for this command (and the tests' injection point).
 *
 * Production always uses `runProductionBuild`; the unit tests inject a fake so
 * handover recovery can be proven to run before any real build is attempted.
 */
export interface BuildDeps {
  build(envHash: string, options: ProductionBuildOptions): Promise<BuildResult>;
  /**
   * Why this checkout can never publish a snapshot, or null. The default reads
   * git; the tests inject it so the `snapshot` flag they assert on does not
   * depend on the checkout the suite happens to run in.
   */
  producerReason?(repoRoot: string): string | null;
}

const defaultBuildDeps: BuildDeps = {
  build: (envHash, options) => runProductionBuild(envHash, undefined, options),
};

function snapshotNone(): SnapshotRunStatus {
  return { outcome: 'none', id: null, sizeBytes: null, fileCount: null, reason: null };
}

interface SnapshotRunInput {
  lock: CheckoutLock;
  app: BuildApp;
  envHash: string;
  producerReason: string | null;
  result: BuildResult | null;
  built: boolean;
}

/**
 * Publish the staging copy, or report why there is none.
 *
 * Every step is best-effort: a refused gate, a failed copy and a lost lock all
 * leave the previous snapshot in place and never change the build's exit code.
 * The checkout lock is deliberately free here (and the build's slot and mutex
 * were released when it returned), because publication is the one part of the
 * cache step that takes `snapshot.lock` and writes the pointer.
 */
async function publishSnapshotRun(input: SnapshotRunInput): Promise<SnapshotRunStatus> {
  // `apps/admin` has its own `.next/cache` under the same Next version; v1 covers
  // the web tree only, so an admin build neither stages nor seeds (ADR-0014).
  if (input.app !== 'web') return snapshotNone();
  if (input.producerReason !== null) {
    return { ...snapshotNone(), outcome: 'skipped', reason: input.producerReason };
  }
  let staged = input.result?.staged ?? null;
  let skipReason = input.result?.snapshotSkipped ?? null;
  // A no-op build never reached the spawn, so the copy is taken here — still
  // only when no build holds this worktree's mutex, because that is what makes
  // `.next/cache` quiescent.
  if (staged === null && skipReason === null && !input.built) {
    const holder = buildInProgress();
    if (holder !== null) skipReason = 'a build holds this worktree’s build mutex';
    else {
      const identity = await collectIdentityFacts(REPO_ROOT, input.envHash);
      const copy = await stageSnapshot({
        cacheRoot: resolveCacheDir(),
        worktreeCacheDir: join(REPO_ROOT, 'apps', 'web', '.next', 'cache'),
        identity,
        nextVersion: identity.next ?? '',
      });
      if ('staged' in copy) staged = copy.staged;
      else skipReason = copy.skipped;
    }
  }
  if (staged === null) {
    return {
      ...snapshotNone(),
      outcome: 'skipped',
      reason: skipReason ?? 'no staging copy was taken',
    };
  }

  let published: PublishResult;
  try {
    published = await withReleasedCheckoutLock(
      input.lock,
      async () => {
        const locked = await withSnapshotLock(() =>
          publishSnapshot({
            cacheRoot: resolveCacheDir(),
            staged,
            record: readPublishRecord(),
            gates: readPublishGates({
              repoRoot: REPO_ROOT,
              buildOk: true,
              artifactPresent: buildArtifactPresent(),
              webPid: readWebPid(),
            }),
          }),
        );
        return (
          locked ?? { published: false as const, reason: 'another publish holds the snapshot lock' }
        );
      },
      'snapshot publication returned no result',
    );
  } catch (error) {
    return {
      ...snapshotNone(),
      outcome: 'refused',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!published.published) {
    return { ...snapshotNone(), outcome: 'refused', reason: published.reason };
  }
  return {
    outcome: 'published',
    id: published.id,
    sizeBytes: published.sizeBytes,
    fileCount: published.fileCount,
    reason: null,
  };
}

function seedNone(): SeedRunStatus {
  return { outcome: 'none', id: null, reason: null };
}

/**
 * Seed a worktree whose `.next/cache` is absent, before anything builds.
 *
 * The seed only ever creates a cache that is not there, so a worktree created
 * after the snapshot was published (or before one existed) gets the same start as
 * a `scripts/spin` worktree. It is best-effort: every refusal is reported and the
 * build runs cold. `STUDIQ_CACHE_SEED=0` opts out.
 */
async function seedIfMissing(envHash: string): Promise<SeedRunStatus> {
  if ((process.env['STUDIQ_CACHE_SEED'] ?? '1') === '0') return seedNone();
  if (existsSync(join(REPO_ROOT, 'apps', 'web', '.next', 'cache'))) return seedNone();
  // The checkout lock is free while a build runs, so the mutex is the only fact
  // that says this `.next` is quiescent enough to copy into.
  if (buildInProgress() !== null) {
    return { outcome: 'skipped', id: null, reason: 'a build holds this worktree’s build mutex' };
  }
  const result = await seedWorktreeCache({ worktreeRoot: REPO_ROOT, envHash });
  if (result.status === 'seeded') return { outcome: 'seeded', id: result.id, reason: null };
  return { outcome: result.status, id: null, reason: result.reason };
}

function writeSeedLine(run: SeedRunStatus): void {
  if (run.outcome === 'seeded') {
    writeStderrLine(`build: seeded ${run.id} into apps/web/.next/cache`);
  } else if (run.outcome !== 'none') {
    writeStderrLine(`build: seed ${run.outcome}: ${run.reason}`);
  }
}

function writeSnapshotLine(run: SnapshotRunStatus): void {
  if (run.outcome === 'published') {
    writeStderrLine(
      `build: snapshot ${run.id} published (${Math.round((run.sizeBytes ?? 0) / 1024 / 1024)} MB, ${run.fileCount ?? 0} files)`,
    );
    return;
  }
  if (run.outcome === 'refused') writeStderrLine(`build: snapshot refused: ${run.reason}`);
  else if (run.outcome === 'skipped') writeStderrLine(`build: snapshot skipped: ${run.reason}`);
}

export async function runBuild(
  parsed: ParsedCommand,
  deps: BuildDeps = defaultBuildDeps,
): Promise<number> {
  const options = parsed.build;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'build options are missing');
  const app = options.app;
  const web = app === 'web';
  // The stack facts this run proved, so the manifest's last write is not a guess.
  let manifestStack: ManifestStack | undefined;

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
    manifestStack = stack ? stackFacts(stack.status) : sharedStackFacts();
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
    // A cache miss is the seed's only opening: it never merges into an existing
    // cache, and a refused or mismatched snapshot leaves the build cold.
    const seedRun = web ? await seedIfMissing(envHash) : seedNone();
    if (!parsed.json) writeSeedLine(seedRun);

    // The fingerprint and `.dev/build.json` describe `apps/web`'s artifact. Admin
    // has no fingerprint of its own (ADR-0014, decision 6), so it always builds.
    const previous = web ? readBuildState() : null;
    const current =
      web &&
      classifyBuildArtifact({
        fingerprint: computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash }),
        envHash,
      }) === 'current';
    const built = !current || options.force;
    // Decided before the build so a checkout that can never publish (a linked
    // worktree, a dirty tree, main ahead) does not pay for a 300 MB copy on
    // every build. Publication re-reads every gate, including the ones that are
    // only known once the build has finished.
    const producerReason = web ? (deps.producerReason ?? staticProducerReason)(REPO_ROOT) : null;

    let result: BuildResult | null = null;
    // The record's `builtAt`, or null when no record covers the artifact this
    // run leaves behind (`--no-lock`, and every admin build).
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
        () =>
          deps.build(envHash, {
            app,
            admission: options.admission,
            snapshot: web && producerReason === null,
          }),
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
      if (web && options.admission !== 'no-lock') {
        builtAt = new Date().toISOString();
        writeBuildState({
          fingerprint: result.fingerprintAfter,
          envHash,
          builtAt,
        });
      } else {
        // Nothing on disk claims this artifact, so nothing may report a
        // `builtAt` for it.
        builtAt = null;
      }
    }

    const snapshotRun = await publishSnapshotRun({
      lock,
      app,
      envHash,
      producerReason,
      result,
      built,
    });
    // Publish this run's result before reconciling: the snapshot compares the
    // file with the live probe, and the `finally` write lands after it — so
    // without this, `--json` reports the pre-build file as stale.
    writeEnvManifest({ stack: manifestStack });
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
      // `result` is null exactly when no build ran, so no grant was minted.
      grant: result === null ? null : (result.grant ?? 'unconsumed'),
      built,
      ok: result?.ok ?? true,
      fingerprint: web ? (result?.fingerprintAfter ?? previous?.fingerprint ?? null) : null,
      builtAt,
      snapshot: snapshotRun,
      seed: seedRun,
    };
    if (parsed.json) printJson({ ...snapshot, buildRun });
    else {
      // A build that ran already printed its own finish line (with the duration)
      // from `runProductionBuild`; only the no-op case is this command's to report.
      if (!built) writeStderrLine('Build is already current.');
      writeSnapshotLine(snapshotRun);
    }
    return 0;
  } finally {
    // Every exit path — a no-op build, a refusal after the lease moved, a failed
    // build — leaves `.dev/env.json` describing what this checkout now is.
    writeEnvManifest({ stack: manifestStack });
    await lock.release();
  }
}
