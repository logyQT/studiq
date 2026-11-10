import { lstatSync } from 'node:fs';
import type { ParsedCommand, RuntimeChoice } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { contractWithPort, readContract, type Contract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { assertNativeAvailable, selectRuntime } from '../lib/platform';
import { probePortBind } from '../lib/net';
import { probeHttp } from '../lib/health';
import { readRegistry } from '../lib/registry';
import {
  REPO_ROOT,
  canon,
  currentBranchRef,
  isThisCheckout,
  isThisCheckoutWorkdir,
} from '../lib/repo';
import {
  readListedStackRuntime,
  readStack,
  readStackList,
  stackAbsenceConfirmed,
  type StackEnv,
  type StackRead,
  type StackStatus,
} from '../lib/stack';
import { applyStackEnv, startStack, stopStack } from '../lib/stack-lifecycle';
import {
  observedCapabilities,
  probeCapabilities,
  probeContextFromStatus,
  sharedProbeContext,
} from '../lib/capabilities';
import {
  buildCapabilities,
  excludesFor,
  missingCapabilities,
  profileSeeds,
  type Capability,
} from '../profiles';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import {
  rebuildWithRecovery,
  recoverHandover,
  type RebuildRecoveryInput,
  type RebuildRecoveryResult,
} from '../lib/rebuild';
import { acquireCheckoutLock, pidAlive, withClaimsLock, type CheckoutLock } from '../lib/locks';
import {
  heartbeatAgeMs,
  isLeaseReclaimable,
  leasePath,
  leaseProjectId,
  newLease,
  readLease,
  releaseAppPortClaim,
  releaseProjectClaims,
  removeLease,
  touchLease,
  writeLease,
  type AppLease,
} from '../lib/lease';
import { appPortCandidates, chooseAppPort } from '../lib/app-port';
import { readCachedStack, writeCachedStack, type CachedStack } from '../lib/stack-cache';
import {
  appendEnvLog,
  buildArtifactPresent,
  identityKey,
  readBuildState,
  readStackState,
  writeBuildState,
  writeStackState,
  type StackState,
} from '../lib/state';
import {
  readWebPid,
  recordedWebReadiness,
  startWebServer,
  stopWebServer,
  stopWebServerForReplacement,
  waitForWeb,
  webLogPath,
  type WebReadiness,
} from '../lib/web';
import { liveServerConflict } from '../lib/web-owner';
import { refuseConflict } from '../lib/refusal';
import { collectSnapshot } from '../lib/snapshot';
import { assertSeedingAllowed, runSeeder } from '../lib/seed';
import { resolveLocalAppEnv, sharedStackEnv } from '../lib/app-env';
import { printJson, writeStderrLine } from '../lib/output';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const healthy = (code: number) => code >= 200 && code < 400;

function withPort(contract: Contract, appPort: number): Contract {
  const next = contractWithPort(contract, appPort);
  process.env.APP_PORT = String(next.appPort);
  process.env.APP_URL = next.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= next.appUrl;
  return next;
}

/**
 * A port that already answers belongs to someone. Starting a replacement there
 * would race an unknown listener (and could silently serve another checkout),
 * so readiness must prove the listener is this checkout's recorded server.
 */
function refuseAnsweringPort(appPort: number, webHttp: number, readiness: WebReadiness): void {
  if (healthy(webHttp) && !readiness.ready) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `port ${appPort} is already answering but is not this checkout's server`,
    );
  }
}

/**
 * Stop the previously recorded server (if any), start the replacement, and
 * wait until readiness proves it serves the leased port. A stop that leaves a
 * surviving server aborts before anything is spawned.
 *
 * @public Used by `env:ensure` and exercised by the unit tests, which load this
 * module by computed URL.
 */
export async function startWebReplacement(input: {
  appPort: number;
  appUrl: string;
  env: NodeJS.ProcessEnv;
  webPid: number | null;
  timeoutSeconds?: number;
}): Promise<{ pid: number; http: number }> {
  if (input.webPid !== null) stopWebServerForReplacement();
  const pid = startWebServer({
    appPort: input.appPort,
    appUrl: input.appUrl,
    env: input.env,
  });
  const waited = await waitForWeb(input.appUrl, pid, input.timeoutSeconds ?? 120, input.appPort);
  if (!waited.ok) {
    stopWebServer();
    throw new EnvFailure(
      EXIT_START_FAILED,
      `web did not start (${waited.reason}); see ${webLogPath()}`,
    );
  }
  return { pid, http: waited.http };
}

/**
 * `runSupabase` inherits `SUPABASE_WORKDIR`, and the CLI resolves the stack
 * against it. Reject a foreign workdir before the first status/start/stop so
 * this checkout can never discover, start or stop another checkout's stack.
 */
function assertOwnWorkdir(): void {
  const workdir = process.env.SUPABASE_WORKDIR || null;
  if (workdir !== null && !isThisCheckoutWorkdir(workdir)) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `refusing to run with SUPABASE_WORKDIR '${workdir}': it is not this checkout (${REPO_ROOT}).`,
    );
  }
}

/** A stack read from status is only usable when `project_root` is this checkout. */
function assertOwnedStack(stack: StackRead, stackName: string | null): void {
  if (!isThisCheckout(stack.status.projectRoot)) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `stack '${stackName || 'default'}' belongs to ${stack.status.projectRoot || 'an unknown checkout'}, not this checkout (${REPO_ROOT}); run 'env:down --all' then 'env:ensure' in its checkout.`,
    );
  }
}

/**
 * `.dev/stack.json` attributes the **web server** to a stack/profile; the
 * live-server guard reads it. A serving ensure owns the server, so it records
 * the requested profile. An API-only ensure must not overwrite a running
 * server's attribution — and with no attribution to keep, it writes nothing.
 */
function stackAttribution(input: {
  stackName: string;
  profile: string;
  cold: boolean;
  serve: boolean;
}): StackState | null {
  const updatedAt = new Date().toISOString();
  const previous = readStackState();
  if (!input.serve && readWebPid()) {
    return previous ? { ...previous, cold: input.cold, updatedAt } : null;
  }
  return { stackName: input.stackName, profile: input.profile, cold: input.cold, updatedAt };
}

async function freePort(port: number): Promise<boolean> {
  return port > 0 && (await probePortBind(port)).state === 'free';
}

/**
 * The one I/O seam for the rebuild transaction (and the tests' injection
 * point). Production always uses `rebuildWithRecovery`.
 */
export interface EnsureDeps {
  rebuild(request: RebuildRecoveryInput): Promise<RebuildRecoveryResult>;
}

const defaultEnsureDeps: EnsureDeps = { rebuild: rebuildWithRecovery };

interface BuildRevalidation {
  dir: string;
  projectId: string;
  contract: Contract;
  requested: Capability[];
  /** The environment the build actually ran against. */
  envHash: string;
}

/**
 * Run the rebuild while `checkout.lock` is free and take it back afterwards.
 *
 * A production build takes minutes; holding the checkout-wide lock for it would
 * block every other env command (`down` included) for that whole time. The
 * handover record written before the build keeps recovery ownership of `.next`,
 * so releasing the lock does not hand the artifact to another process. The lock
 * is re-acquired even when the build fails, so the failure path still owns the
 * lease and the attribution it writes.
 */
async function rebuildWithoutCheckoutLock(
  lock: CheckoutLock,
  request: RebuildRecoveryInput,
  deps: EnsureDeps,
): Promise<RebuildRecoveryResult> {
  await lock.release();
  let outcome: RebuildRecoveryResult | null = null;
  let failure: unknown;
  let failed = false;
  try {
    outcome = await deps.rebuild(request);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await lock.acquire();
  } catch (error) {
    // The build failure is the useful report: do not mask it with a lock
    // conflict from the re-acquire. A successful build must surface it.
    if (!failed) throw error;
  }
  if (failed) throw failure;
  if (outcome === null) throw new EnvFailure(EXIT_START_FAILED, 'rebuild returned no result');
  return outcome;
}

/**
 * Rebuild only when nothing proves the recorded build still matches this
 * environment. The rebuild itself runs without the checkout lock (see
 * `rebuildWithoutCheckoutLock`).
 */
async function rebuildIfNeeded(
  input: {
    lock: CheckoutLock;
    force: boolean;
    envHash: string;
    appPort: number;
    appUrl: string;
    serve: boolean;
  },
  deps: EnsureDeps,
): Promise<RebuildRecoveryResult | null> {
  const state = readBuildState();
  const current =
    state?.envHash === input.envHash &&
    state.fingerprint ===
      computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash: input.envHash }) &&
    buildArtifactPresent();
  if (!input.force && current) return null;
  return rebuildWithoutCheckoutLock(
    input.lock,
    {
      envHash: input.envHash,
      appPort: input.appPort,
      appUrl: input.appUrl,
      env: process.env,
      serve: input.serve,
    },
    deps,
  );
}

/**
 * The build ran while `checkout.lock` was free: `down` (or another env process)
 * may have released this checkout's lease or moved it to another port. Re-read
 * it before anything is written, served or reported.
 */
function reassertLease(input: BuildRevalidation): void {
  const lease = readLease(input.dir, input.projectId);
  if (!lease) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      "another env process released this checkout's app-port lease during the build; re-run 'env:ensure'",
    );
  }
  if (lease.appPort !== input.contract.appPort) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `the app-port lease moved to ${lease.appPort} during the build (was ${input.contract.appPort}); re-run 'env:ensure'`,
    );
  }
}

/**
 * Re-read the local stack after a build, then prove it still matches the
 * environment the build was made for. A stack that stopped, changed its
 * endpoints or lost a requested capability means the build and the environment
 * no longer agree: fail instead of serving or reporting stale state.
 */
async function revalidateLocalStack(
  input: BuildRevalidation & { stackName: string | null },
): Promise<StackRead> {
  reassertLease(input);
  const stack = readStack(input.stackName);
  if (!stack) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `stack '${input.stackName || 'default'}' stopped during the build; re-run 'env:ensure' to start it (the build is kept)`,
    );
  }
  assertOwnedStack(stack, input.stackName);
  const probe = await probeCapabilities(input.requested, probeContextFromStatus(stack.status));
  if (!probe.ok) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `stack '${input.stackName || 'default'}' changed during the build and is missing: ${probe.failed.join(', ')}; re-run 'env:ensure'`,
    );
  }
  const envHash = buildEnvHash({
    supabaseUrl: stack.env.apiUrl,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || input.contract.appUrl,
    anonKey: stack.env.anonKey ?? '',
  });
  if (envHash !== input.envHash) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      "the stack endpoints changed during the build; re-run 'env:ensure' so the build matches the stack",
    );
  }
  return stack;
}

/** The shared-stack counterpart of `revalidateLocalStack`: no stack to start. */
async function revalidateSharedStack(input: BuildRevalidation): Promise<void> {
  reassertLease(input);
  const env = sharedStackEnv();
  if (!env.apiUrl) {
    throw new EnvFailure(EXIT_START_FAILED, 'SUPABASE_SHARED=1 needs SUPABASE_URL and keys');
  }
  const probe = await probeCapabilities(input.requested, sharedProbeContext());
  if (!probe.ok) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `shared stack changed during the build and is missing: ${probe.failed.join(', ')}; re-run 'env:ensure'`,
    );
  }
  const envHash = buildEnvHash({
    supabaseUrl: env.apiUrl,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || input.contract.appUrl,
    anonKey: env.anonKey ?? '',
  });
  if (envHash !== input.envHash) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      "the shared Supabase environment changed during the build; re-run 'env:ensure'",
    );
  }
}

export interface ReclaimForeignLeaseInput {
  dir: string;
  foreignProjectId: string;
  port: number;
  /** Point-in-time verdict for a foreign lease: owner dead, expired, stack down. */
  isReclaimable(lease: AppLease): boolean;
  /** The async window between the first look and the coordinated re-check. */
  probeFree(port: number): Promise<boolean>;
  /** Test seam: a concurrent owner heartbeat refresh landing in that window. */
  afterInitialCheck?(): void;
}

/**
 * Reclaim another checkout's lease for `port` once its owner is provably gone.
 *
 * The first look is uncoordinated, so the owner can refresh its heartbeat (or a
 * peer can reclaim the same lease) before the removal. The final re-check, the
 * lease removal and the claim release therefore run as one unit under the
 * registry-wide claims mutex, and the lease is re-read inside it: a lease that
 * became live again keeps both the lease and its port claim.
 *
 * @public Used by `env:ensure` and exercised by the unit tests, which load this
 * module by computed URL.
 */
export async function reclaimForeignLease(input: ReclaimForeignLeaseInput): Promise<boolean> {
  const raw = readLease(input.dir, input.foreignProjectId);
  if (!raw || !input.isReclaimable(raw) || !(await input.probeFree(input.port))) return false;
  input.afterInitialCheck?.();
  return withClaimsLock(() => {
    const latest = readLease(input.dir, input.foreignProjectId);
    if (!latest || !input.isReclaimable(latest)) return false;
    removeLease(input.dir, input.foreignProjectId);
    releaseAppPortClaim(input.dir, input.port, input.foreignProjectId);
    return true;
  });
}

async function resolveLease(
  contract: Contract,
  options: {
    stackName: string | null;
    branch: string;
    explicitPort: number | null;
    serve: boolean;
    /** A stack is already running and will be reused. */
    runningStack: boolean;
  },
): Promise<{ contract: Contract; lease: AppLease; dir: string; projectId: string }> {
  const key = identityKey(REPO_ROOT, options.branch, options.stackName ?? '');
  const projectId = leaseProjectId(key);
  const dir = readRegistry().dir;
  const existing = readLease(dir, projectId);
  // A running stack's auth redirects are bound to the URL it was started with,
  // which the lease records. Moving the lease under it would leave those
  // redirects on the old port, so a derived URL may not follow a new port.
  const runningPort = options.runningStack ? existing?.appPort || contract.appPort : null;
  const derivedUrl = !process.env.APP_URL;
  if (
    runningPort !== null &&
    derivedUrl &&
    options.explicitPort !== null &&
    options.explicitPort !== runningPort
  ) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `app port ${options.explicitPort} differs from the running stack's port ${runningPort}; run 'env:down --all' then 'env:ensure'.`,
    );
  }
  const reclaimable = (lease: AppLease, stackRunning: boolean): boolean =>
    isLeaseReclaimable({
      pidAlive: pidAlive(lease.ownerPid),
      heartbeatAgeMs: heartbeatAgeMs(lease),
      ttlSec: lease.ttlSec,
      stackRunning,
    });
  const chosen = await chooseAppPort({
    dir,
    projectId,
    candidates: appPortCandidates({
      existingPort: existing?.appPort || null,
      defaultPort: contract.appPort,
      explicitPort: options.explicitPort,
    }),
    existingPort: existing?.appPort || null,
    explicitPort: options.explicitPort,
    isPortFree: freePort,
    // Another checkout's lease holds the candidate: reclaim it only when its
    // process is gone, its heartbeat expired and its stack is not running.
    reclaimForeign: async (foreign, port) => {
      const raw = readLease(dir, foreign.projectId);
      if (!raw) {
        // `readLease` also returns null for a foreign/non-env entry: only a
        // genuinely missing file may be reclaimed, never one we do not own.
        return (
          lstatSync(leasePath(dir, foreign.projectId), { throwIfNoEntry: false }) === undefined
        );
      }
      const listed = readStackList();
      if (listed === null) return false;
      const running = listed.some(
        (stack) =>
          canon(stack.projectRoot) === canon(raw.projectRoot) &&
          (stack.name || 'default') === (raw.stackName || 'default') &&
          stack.owner === 'reachable',
      );
      return reclaimForeignLease({
        dir,
        foreignProjectId: foreign.projectId,
        port,
        isReclaimable: (lease) => reclaimable(lease, running),
        probeFree: freePort,
      });
    },
  });
  if (runningPort !== null && derivedUrl && chosen !== runningPort) {
    releaseAppPortClaim(dir, chosen, projectId);
    throw new EnvFailure(
      EXIT_CONFLICT,
      `app port ${chosen} differs from the running stack's port ${runningPort}; run 'env:down --all' then 'env:ensure'.`,
    );
  }
  const next = withPort(contract, chosen);
  const lease = touchLease(
    existing ??
      newLease({
        projectId,
        projectRoot: REPO_ROOT,
        branch: options.branch,
        stackName: options.stackName ?? '',
        appPort: chosen,
        shared: contract.shared,
        sharedOwner: contract.sharedOwner,
        mode: options.serve ? 'prod' : 'dev',
      }),
    {
      appPort: chosen,
      ownerPid: readWebPid() ?? 0,
      mode: options.serve ? 'prod' : 'dev',
    },
  );
  writeLease(lease);
  // The claim follows the selected port only: a moved lease drops the old one.
  releaseProjectClaims(dir, projectId, chosen);
  return { contract: next, lease, dir, projectId };
}

function runtimeFor(
  flag: RuntimeChoice | null,
  persisted: string | null,
  profile: string,
): RuntimeChoice {
  const selected = selectRuntime(flag);
  if (persisted && selected.explicit && persisted !== selected.runtime) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      `this stack uses runtime=${persisted}; re-run with --runtime ${persisted}`,
    );
  }
  const runtime = (persisted || selected.runtime) as RuntimeChoice;
  if (runtime === 'native') assertNativeAvailable(profile);
  return runtime;
}

async function waitReady(
  caps: Capability[],
  stack: StackRead,
  timeoutSeconds: number,
): Promise<boolean> {
  const context = probeContextFromStatus(stack.status);
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    if ((await probeCapabilities(caps, context)).ok) return true;
    if (Date.now() >= deadline) return false;
    await sleep(500);
  }
}

function emit(
  parsed: ParsedCommand,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  profile: string,
  cold: boolean,
  url: string,
) {
  if (parsed.json) printJson(snapshot);
  else {
    writeStderrLine(`env: ensure ready — profile=${profile} cold=${cold}`);
    writeStderrLine(`  app      ${url}`);
    writeStderrLine('  log      .dev/env.log');
  }
}

/**
 * A `StackEnv` shaped from a status record. The key fields stay null: the warm
 * path never applies this to `process.env` (see the `applyStackEnv` guard), it
 * only satisfies the `StackRead` shape the reporting path already understands.
 */
function stackEnvFromStatus(status: StackStatus): StackEnv {
  return {
    apiUrl: status.apiUrl,
    restUrl: status.apiUrl ? `${status.apiUrl}/rest/v1` : null,
    dbUrl: status.dbUrl,
    anonKey: null,
    serviceRoleKey: null,
    publishableKey: null,
    secretKey: null,
    mailUrl: status.mailUrl,
    studioUrl: status.studioUrl,
  };
}

/** What the warm path proved, and therefore what it may skip. */
interface WarmEvidence {
  status: StackStatus;
  services: string[];
  /** Build environment hash recorded with the observation (no keys needed). */
  envHash: string;
}

/**
 * The warm path (spec §6): reuse this checkout's recorded stack observation
 * when every decision it feeds is independently proven — requested capabilities
 * answer their probes, the recorded build still matches, and the owned server
 * still serves the leased port. Nothing here mutates state.
 *
 * Anything unproven returns null: the caller then takes the authoritative
 * `stack status` read (and, if needed, the cold-start path). Keys are never
 * cached, so a request that needs them (a build, a seed, or starting/replacing
 * the server) also takes the authoritative read.
 */
async function warmFromCache(input: {
  cached: CachedStack;
  requested: Capability[];
  contract: Contract;
  build: boolean;
  forceBuild: boolean;
  serve: boolean;
  seed: boolean;
}): Promise<WarmEvidence | null> {
  const { cached } = input;
  if (input.seed || input.forceBuild) return null;
  if (missingCapabilities(observedCapabilities(cached.services), input.requested).length > 0) {
    return null;
  }
  if (!(await probeCapabilities(input.requested, probeContextFromStatus(cached.status))).ok) {
    return null;
  }
  if (input.build) {
    const state = readBuildState();
    const current =
      state?.envHash === cached.envHash &&
      state.fingerprint ===
        computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash: cached.envHash }) &&
      buildArtifactPresent();
    if (!current || cached.appUrl !== input.contract.appUrl) return null;
  }
  if (input.serve) {
    // A server that must be started or replaced needs the stack's keys, which
    // are deliberately not cached. Only an already-proven server is warm.
    const readiness = recordedWebReadiness(input.contract.appPort);
    if (!readiness.ready || !healthy(await probeHttp(input.contract.appUrl))) return null;
  }
  return { status: cached.status, services: cached.services, envHash: cached.envHash };
}

export async function runEnsure(
  parsed: ParsedCommand,
  deps: EnsureDeps = defaultEnsureDeps,
): Promise<number> {
  const options = parsed.ensure;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'ensure options are missing');
  assertOwnWorkdir();
  const appEnv = resolveLocalAppEnv();
  const baseContract = readContract();
  const branch = currentBranchRef();
  const cliStackName = options.stack ?? baseContract.stackName;
  const requested = [...buildCapabilities(options.profile, options.capabilityAtoms)];
  // The profile default decides unless an atom overrides it (`--no-seed` wins).
  const seedRequested =
    options.seed === 'default' ? profileSeeds(options.profile) : options.seed === 'seed';
  const seed = assertSeedingAllowed({
    mode: seedRequested ? 'seed' : 'no-seed',
    shared: baseContract.shared,
  });
  appendEnvLog(`ensure: profile=${options.profile} stack=${cliStackName ?? 'default'}`);

  // One lock per checkout: the app-port lease and the web claim are authoritative
  // while it is held. The build lock is taken later, inside the build, and the
  // checkout lock is deliberately released around that build (see
  // `rebuildWithoutCheckoutLock`) so a concurrent `down` is never blocked for
  // the whole build.
  const lock = await acquireCheckoutLock();
  try {
    // Settle an artifact left behind by an interrupted rebuild before the lease
    // or the build looks at `.next`; the record lives in this checkout's `.dev/`.
    // A record owned by a live process is the in-flight build: the checkout lock
    // is free for it, so an ensure that would build or serve `.next` refuses
    // before it can stop that rebuild's server or move the artifact it owns.
    const recovery = recoverHandover();
    if (recovery.status === 'in-flight' && (options.build || options.serve)) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `another env process (pid ${recovery.ownerPid}) is rebuilding apps/web/.next; retry once its build handover settles`,
      );
    }

    // Refuse a second environment before claiming a port or writing state.
    if (options.build || options.serve) {
      const conflict = liveServerConflict(
        { stackName: cliStackName ?? 'default', profile: options.profile },
        'start',
      );
      if (conflict) return refuseConflict(parsed, baseContract, conflict);
    }

    // Discover the running stack before touching the lease: a foreign stack is
    // refused, and a live stack pins the derived APP_URL port it was started on.
    //
    // Warm path first: this checkout's recent own observation can stand in for
    // `stack status` (~650 ms) only when the capability probes, the recorded
    // build and the owned server all still prove the same facts (see
    // `warmFromCache`). Everything else takes the authoritative read below.
    const cached = baseContract.shared ? null : readCachedStack(cliStackName);
    const warmContract = contractWithLease(baseContract);
    let warm = cached
      ? await warmFromCache({
          cached,
          requested,
          contract: warmContract,
          build: options.build,
          forceBuild: options.forceBuild,
          serve: options.serve,
          seed,
        })
      : null;

    let stack = baseContract.shared
      ? null
      : warm
        ? { status: warm.status, services: warm.services, env: stackEnvFromStatus(warm.status) }
        : readStack(cliStackName);
    if (stack && !warm) assertOwnedStack(stack, cliStackName);

    const lease = await resolveLease(baseContract, {
      stackName: cliStackName,
      branch,
      explicitPort: options.appPort,
      serve: options.serve,
      runningStack: stack !== null,
    });
    const contract = { ...lease.contract, stackName: cliStackName };
    const { dir, projectId } = lease;
    if (warm && contract.appPort !== warmContract.appPort) {
      // The lease moved between the warm proof and the claim: the web evidence
      // belongs to the old port, so re-read the stack authoritatively.
      warm = null;
      stack = baseContract.shared ? null : readStack(cliStackName);
      if (stack) assertOwnedStack(stack, cliStackName);
    }

    if (baseContract.shared) {
      const sharedEnv = sharedStackEnv();
      if (!sharedEnv.apiUrl) {
        throw new EnvFailure(EXIT_START_FAILED, 'SUPABASE_SHARED=1 needs SUPABASE_URL and keys');
      }
      const probe = await probeCapabilities(requested, sharedProbeContext());
      if (!probe.ok) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          `shared stack is missing: ${probe.failed.join(', ')}`,
        );
      }
      applyStackEnv(sharedEnv, { appUrl: contract.appUrl, appEnv });
      if (seed) runSeeder(options.profile, process.env);
      const envHash = buildEnvHash({
        supabaseUrl: sharedEnv.apiUrl,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
        anonKey: sharedEnv.anonKey ?? '',
      });
      let webPid = readWebPid();
      let webHttp = 0;
      let webStarted = false;
      if (options.build) {
        const outcome = await rebuildIfNeeded(
          {
            lock,
            force: options.forceBuild,
            envHash,
            appPort: contract.appPort,
            appUrl: contract.appUrl,
            serve: options.serve,
          },
          deps,
        );
        if (outcome) {
          // The checkout lock was free for the build: re-read the lease and the
          // shared environment before anything is written or reported.
          await revalidateSharedStack({ dir, projectId, contract, requested, envHash });
          writeBuildState({
            fingerprint: outcome.build.fingerprintAfter,
            envHash,
            builtAt: new Date().toISOString(),
          });
          webPid = outcome.webPid;
          webHttp = outcome.webHttp;
          webStarted = outcome.webStarted;
          if (options.serve) webHttp = await probeHttp(contract.appUrl);
        }
      }
      if (!webStarted) {
        const warmWeb = recordedWebReadiness(contract.appPort);
        webHttp = await probeHttp(contract.appUrl);
        if (options.serve && (!healthy(webHttp) || !warmWeb.ready)) {
          // Any owned server that is not (healthy and) serving the leased port is
          // replaced, so a foreign listener on the port cannot be mistaken for it.
          // A port that already answers without a provable owner is refused, and
          // a stop that leaves the old server alive aborts the replacement.
          refuseAnsweringPort(contract.appPort, webHttp, warmWeb);
          const started = await startWebReplacement({
            appPort: contract.appPort,
            appUrl: contract.appUrl,
            env: process.env,
            webPid,
          });
          webPid = started.pid;
          webHttp = started.http;
        }
      }
      writeLease(touchLease(lease.lease, { appPort: contract.appPort, ownerPid: webPid ?? 0 }));
      // There is no local stack to describe, but the served web process still
      // needs attribution so a second shared ensure (or a later build) is not
      // mistaken for a different environment.
      const stackState = stackAttribution({
        stackName: contract.stackName ?? 'default',
        profile: options.profile,
        cold: false,
        serve: options.serve,
      });
      if (stackState) writeStackState(stackState);
      const snapshot = await collectSnapshot({
        contract,
        stack: null,
        state: stackState,
        skipStackLookup: true,
        web: { pid: webPid, http: webHttp },
        supabaseHttp: 200,
        ready: true,
        profile: options.profile,
        cold: false,
        warnings: ['shared stack (no mutation)'],
      });
      emit(parsed, snapshot, options.profile, false, contract.appUrl);
      return 0;
    }

    let cold = false;
    if (stack) {
      const missing = missingCapabilities(observedCapabilities(stack.services), requested);
      if (missing.length > 0) {
        return refuseConflict(
          parsed,
          contract,
          `running stack lacks capability: ${missing.join(', ')}; run 'env:down --all' then 'env:ensure'`,
        );
      }
      if (!(await probeCapabilities(requested, probeContextFromStatus(stack.status))).ok) {
        // The stack answers status but not its capabilities: stop it and start a
        // fresh one, but only when that stop is provable. A failed stop with the
        // stack still listed may still own its ports, so the lease, its claim and
        // the attribution stay put instead of being handed to the next checkout —
        // and no restart is attempted over a stack that may still be running.
        const stopped = stopStack(cliStackName);
        if (!stopped.ok && !stackAbsenceConfirmed(cliStackName || 'default')) {
          const heldPort = readLease(dir, projectId)?.appPort || contract.appPort;
          throw new EnvFailure(
            EXIT_START_FAILED,
            `running stack is unresponsive and its stop failed; keeping app port ${heldPort} claimed (run 'env:down --all' once the stack stops)`,
          );
        }
        stack = null;
      }
    }
    if (!stack) {
      cold = true;
      const runtime = runtimeFor(
        options.runtime,
        readListedStackRuntime(cliStackName),
        options.profile,
      );
      const timeout = (options.waitSeconds ?? 180) * 1000;
      const result = startStack({
        stackName: cliStackName,
        runtime,
        excludes: excludesFor(requested),
        timeoutMs: timeout,
      });
      if (!result.ok) {
        // Same rule as `down`: a failed stop is only forgiven when `stack list`
        // proves our stack is gone. Otherwise the stack may still own the port,
        // so the lease and its claim stay put instead of being handed to the
        // next checkout.
        const stopped = stopStack(cliStackName);
        if (!stopped.ok && !stackAbsenceConfirmed(cliStackName || 'default')) {
          const heldPort = readLease(dir, projectId)?.appPort || contract.appPort;
          throw new EnvFailure(
            EXIT_START_FAILED,
            `failed to start stack and its stop failed; keeping app port ${heldPort} claimed (run 'env:down --all' once the stack stops)`,
          );
        }
        removeLease(dir, projectId);
        releaseProjectClaims(dir, projectId);
        throw new EnvFailure(
          result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED,
          result.timedOut
            ? 'stack start timed out'
            : `failed to start stack: ${result.stderr.trim()}`,
        );
      }
      stack = readStack(cliStackName);
      if (!stack) throw new EnvFailure(EXIT_START_FAILED, 'stack started without endpoints');
      assertOwnedStack(stack, cliStackName);
      if (!(await waitReady(requested, stack, options.waitSeconds ?? 180))) {
        throw new EnvFailure(EXIT_TIMEOUT, 'stack did not become ready');
      }
    }

    // The warm path carries no keys and needs none: it only reuses a server that
    // is already running. Every other path relays the discovered values.
    if (!warm) {
      applyStackEnv(stack.env, { appUrl: contract.appUrl, appEnv, stackId: stack.status.id });
    }
    if (seed) runSeeder(options.profile, process.env);

    const envHash =
      warm?.envHash ??
      buildEnvHash({
        supabaseUrl: stack.env.apiUrl,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
        anonKey: stack.env.anonKey ?? '',
      });
    let webPid = readWebPid();
    let webHttp = 0;
    let webStarted = false;
    if (options.build && !warm) {
      const outcome = await rebuildIfNeeded(
        {
          lock,
          force: options.forceBuild,
          envHash,
          appPort: contract.appPort,
          appUrl: contract.appUrl,
          serve: options.serve,
        },
        deps,
      );
      if (outcome) {
        // The checkout lock was free for the build: `down` (or another env
        // process) may have released the lease or stopped/changed the stack.
        // Prove the environment still matches the build before serving it.
        stack = await revalidateLocalStack({
          dir,
          projectId,
          contract,
          requested,
          envHash,
          stackName: cliStackName,
        });
        applyStackEnv(stack.env, { appUrl: contract.appUrl, appEnv, stackId: stack.status.id });
        writeBuildState({
          fingerprint: outcome.build.fingerprintAfter,
          envHash,
          builtAt: new Date().toISOString(),
        });
        webPid = outcome.webPid;
        webHttp = outcome.webHttp;
        webStarted = outcome.webStarted;
        if (options.serve) webHttp = await probeHttp(contract.appUrl);
      }
    }

    if (!webStarted) {
      const warmWeb = recordedWebReadiness(contract.appPort);
      webHttp = await probeHttp(contract.appUrl);
      if (options.serve && (!healthy(webHttp) || !warmWeb.ready)) {
        if (warm) {
          // The warm path carries no keys, so it may not start a replacement.
          // The server stopped after the warm probes: re-read the stack (it is
          // still up — the capability probes just passed) and relay its values.
          const refreshed = readStack(cliStackName);
          if (!refreshed) {
            throw new EnvFailure(
              EXIT_START_FAILED,
              `stack '${cliStackName || 'default'}' changed while serving; re-run 'env:ensure'`,
            );
          }
          assertOwnedStack(refreshed, cliStackName);
          stack = refreshed;
          warm = null;
          applyStackEnv(stack.env, { appUrl: contract.appUrl, appEnv, stackId: stack.status.id });
        }
        // A port that already answers without a provable owner is refused, and a
        // server that survives its stop would race the replacement for the port;
        // both abort instead of starting a second server.
        refuseAnsweringPort(contract.appPort, webHttp, warmWeb);
        const started = await startWebReplacement({
          appPort: contract.appPort,
          appUrl: contract.appUrl,
          env: process.env,
          webPid,
        });
        webPid = started.pid;
        webHttp = started.http;
      }
    }

    const ready =
      (!options.serve || healthy(webHttp)) &&
      (await probeCapabilities(requested, probeContextFromStatus(stack.status))).ok;
    if (!ready) throw new EnvFailure(EXIT_START_FAILED, 'stack is not ready');
    const stackState = stackAttribution({
      stackName: stack.status.name,
      profile: options.profile,
      cold,
      serve: options.serve,
    });
    if (stackState) writeStackState(stackState);
    writeLease(
      touchLease(lease.lease, {
        appPort: contract.appPort,
        apiPort: stack.status.ports.api,
        dbPort: stack.status.ports.db,
        studioPort: stack.status.ports.studio,
        mailPort: stack.status.ports.mail,
        ownerPid: webPid ?? 0,
        mode: options.serve ? 'prod' : 'dev',
      }),
    );
    // Record what was just proven so the next warm `ensure` can skip
    // `stack status` (keys are never part of this record).
    writeCachedStack({
      stackName: cliStackName ?? '',
      status: stack.status,
      services: stack.services,
      envHash,
      appUrl: contract.appUrl,
    });
    const snapshot = await collectSnapshot({
      contract,
      stack: stack.status,
      state: stackState ?? readStackState(),
      skipStackLookup: true,
      web: { pid: webPid, http: webHttp },
      supabaseHttp: 200,
      ready,
      profile: options.profile,
      cold,
    });
    emit(parsed, snapshot, options.profile, cold, contract.appUrl);
    return 0;
  } finally {
    await lock.release();
  }
}
