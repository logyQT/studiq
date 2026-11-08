import type { ParsedCommand, RuntimeChoice } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { contractWithPort, readContract, type Contract } from '../lib/contract';
import {
  appendEnvLog,
  buildArtifactPresent,
  identityKey,
  isStackRecordFresh,
  readBuildState,
  readStackRecord,
  removeStackRecord,
  writeBuildState,
  writeStackRecord,
  type StackRecord,
} from '../lib/state';
import {
  acquireStartLock,
  ensureRegistryDir,
  pidAlive,
  withCheckoutWebLock,
  withRegistryLeaseLock,
} from '../lib/locks';
import { buildWithStableFingerprint } from '../lib/build-run';
import {
  heartbeatAgeMs,
  isLeaseReclaimable,
  leaseProjectId,
  newLease,
  readLease,
  removeLease,
  touchLease,
  writeLease,
  type AppLease,
} from '../lib/lease';
import { readRegistry } from '../lib/registry';
import { REPO_ROOT, canon, currentBranchRef, isThisCheckout } from '../lib/repo';
import { canBindPort } from '../lib/net';
import { probeHttp } from '../lib/health';
import { readListedStackRuntime, readStack, readStackList, type StackRead } from '../lib/stack';
import { applyStackEnv, startStack, stopStack } from '../lib/stack-lifecycle';
import {
  capabilityConflictMessage,
  capabilityDecision,
  observedCapabilities,
  probeCapabilities,
  probeContextFromRecord,
  probeContextFromStatus,
  sharedProbeContext,
} from '../lib/capabilities';
import { buildCapabilities, excludesFor, type Capability } from '../profiles';
import {
  assertNativeAvailable,
  DOCKER_NOTICE,
  dockerStackWarning,
  selectRuntime,
} from '../lib/platform';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import {
  readWebPid,
  readWebPort,
  startWebServer,
  stopWebServer,
  waitForWeb,
  webLogPath,
} from '../lib/web';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot, stateKeyFor, statusFromRecord } from '../lib/snapshot';
import { assertSeedingAllowed, seedMarkerCurrent } from '../lib/seed';
import { liveServerConflict } from '../lib/web-owner';
import { refuseSecondServer } from '../lib/refusal';

const MIN_PORT = 3000;
const MAX_PORT = 3999;
const RESERVED_APP_PORTS = new Set([3010]);

function resolveLocalAppEnv(): string {
  const raw = (process.env.APP_ENV ?? '').trim().toLowerCase();
  const value = raw || 'development';
  if (value === 'production') {
    throw new EnvFailure(
      EXIT_START_FAILED,
      'APP_ENV=production cannot serve this local checkout (it requires a live Stripe key and an https site URL); set APP_ENV=development, test or qa',
    );
  }
  if (value !== 'development' && value !== 'test' && value !== 'qa') {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `APP_ENV='${value}' is not valid for a local checkout (use development, test or qa)`,
    );
  }
  return value;
}

function applyPort(contract: Contract): void {
  process.env.APP_PORT = String(contract.appPort);
  process.env.APP_URL = contract.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWebHealthy(http: number): boolean {
  return http >= 200 && http < 400;
}

function stackLabel(name: string | null): string {
  return name || 'default';
}

function recordMatches(record: StackRecord | null, name: string | null, branch: string): boolean {
  return (
    record !== null &&
    isThisCheckout(record.projectRoot) &&
    (record.name || 'default') === stackLabel(name) &&
    (record.branch ?? '') === branch
  );
}

function recordFromStackRead(
  read: StackRead,
  options: { profile: string; cold: boolean; previous: StackRecord | null; appUrl: string },
): StackRecord {
  const envHash = read.env.anonKey
    ? buildEnvHash({
        supabaseUrl: read.env.apiUrl,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL || options.appUrl,
        anonKey: read.env.anonKey,
      })
    : (options.previous?.envHash ?? null);
  const now = new Date().toISOString();
  return {
    version: 1,
    stackId: read.status.id,
    name: read.status.name,
    branch: read.status.branch,
    projectRoot: REPO_ROOT,
    runtime: read.status.runtime || (options.previous?.runtime ?? ''),
    capabilities: observedCapabilities(read.services),
    ports: read.status.ports,
    urls: {
      supabase: read.status.apiUrl,
      db: read.status.dbUrl,
      mail: read.status.mailUrl,
      studio: read.status.studioUrl,
    },
    profile: options.profile,
    cold: options.cold,
    envHash,
    createdAt: options.previous?.createdAt ?? now,
    updatedAt: now,
    heartbeatAt: now,
  };
}

function recordFromExisting(
  record: StackRecord,
  options: { profile: string; cold: boolean },
): StackRecord {
  const now = new Date().toISOString();
  return {
    ...record,
    profile: options.profile,
    cold: options.cold,
    updatedAt: now,
    heartbeatAt: now,
  };
}

async function freePort(port: number): Promise<boolean> {
  return port > 0 && (await canBindPort(port));
}

async function ownWebOn(port: number): Promise<boolean> {
  const pid = readWebPid();
  if (!pid || readWebPort(pid) !== port) return false;
  return isWebHealthy(await probeHttp(`http://localhost:${port}`));
}

interface LeaseResolution {
  contract: Contract;
  lease: AppLease;
  dir: string;
  projectId: string;
  pendingExplicitChange: boolean;
}

async function resolveLeaseLocked(options: {
  contract: Contract;
  cliStackName: string | null;
  branch: string;
  key: string;
  explicitPort: number | null;
  serve: boolean;
}): Promise<LeaseResolution> {
  const dir = ensureRegistryDir();
  const projectId = leaseProjectId(options.key);
  const stackName = options.cliStackName ?? '';
  const existing = readLease(dir, projectId);

  const preferred = options.contract.appPort || 3000;
  const candidates: number[] = [];
  if (options.explicitPort) candidates.push(options.explicitPort);
  else if (existing?.appPort) candidates.push(existing.appPort);
  else candidates.push(preferred);
  if (!options.explicitPort) {
    for (let port = MIN_PORT; port <= MAX_PORT; port += 1) {
      if (RESERVED_APP_PORTS.has(port) || candidates.includes(port)) continue;
      candidates.push(port);
    }
  }

  let chosen = 0;
  for (const port of candidates) {
    if (port < 1 || port > 65535 || RESERVED_APP_PORTS.has(port)) continue;
    // Re-read under the lease lock on every candidate: a non-`env` writer
    // (`scripts/dev`) may have claimed a port since the previous attempt.
    const registry = readRegistry();
    const foreign = registry.entries.find(
      (entry) => entry.projectId !== projectId && entry.appPort === port,
    );
    if (foreign && port !== existing?.appPort) {
      const raw = readLease(dir, foreign.projectId);
      const listed = raw ? readStackList() : null;
      const ownerRunning =
        raw !== null &&
        (listed ?? []).some(
          (stack) =>
            canon(stack.projectRoot) === canon(raw.projectRoot) &&
            (stack.name || 'default') === (raw.stackName || 'default') &&
            (stack.branch ?? '') === raw.branch &&
            stack.owner === 'reachable',
        );
      const reclaimable =
        raw !== null &&
        isLeaseReclaimable({
          pidAlive: pidAlive(raw.ownerPid),
          heartbeatAgeMs: heartbeatAgeMs(raw),
          ttlSec: raw.ttlSec,
          stackRunning: ownerRunning,
        }) &&
        (await freePort(port));
      if (!reclaimable) {
        if (options.explicitPort) {
          throw new EnvFailure(
            EXIT_CONFLICT,
            `app port ${port} is leased by ${foreign.worktree || foreign.projectId}`,
          );
        }
        continue;
      }
      // Reclaim both the stale lease and its stale capability record. Leaving
      // the lease file would let the foreign checkout resurrect the same port
      // from `existing.appPort` and skip the free/conflict checks.
      removeLease(dir, foreign.projectId);
      if (raw) {
        removeStackRecord(identityKey(canon(raw.projectRoot), raw.branch, raw.stackName || ''));
      }
    }
    if (port !== existing?.appPort && !(await freePort(port)) && !(await ownWebOn(port))) {
      if (options.explicitPort) {
        throw new EnvFailure(EXIT_CONFLICT, `app port ${port} is already in use`);
      }
      continue;
    }
    chosen = port;
    break;
  }
  if (!chosen) {
    throw new EnvFailure(EXIT_CONFLICT, `no free app port found in ${MIN_PORT}-${MAX_PORT}`);
  }

  const contract = contractWithPort(options.contract, chosen);
  applyPort(contract);
  const base =
    existing ??
    newLease({
      projectId,
      projectRoot: REPO_ROOT,
      branch: options.branch,
      stackName,
      appPort: chosen,
      shared: options.contract.shared,
      sharedOwner: options.contract.sharedOwner,
      mode: options.serve ? 'prod' : 'dev',
    });
  const lease = touchLease(base, {
    appPort: chosen,
    worktree: REPO_ROOT,
    projectRoot: REPO_ROOT,
    branch: options.branch,
    stackName,
    mode: options.serve ? 'prod' : 'dev',
    shared: options.contract.shared,
    sharedOwner: options.contract.sharedOwner,
    ownerPid: readWebPid() ?? 0,
  });

  const pendingExplicitChange = Boolean(
    options.explicitPort && existing && existing.appPort !== chosen,
  );
  if (!pendingExplicitChange) writeLease(lease);
  return { contract, lease, dir, projectId, pendingExplicitChange };
}

async function resolveLease(options: {
  contract: Contract;
  cliStackName: string | null;
  branch: string;
  key: string;
  explicitPort: number | null;
  serve: boolean;
}): Promise<LeaseResolution> {
  // Serialize read-registry + probe + write-lease across checkouts. The start
  // lock is separate and is taken after the port decision.
  return withRegistryLeaseLock(() => resolveLeaseLocked(options));
}

async function describeWebStartFailure(
  contract: Contract,
  reason: string,
  profile: string,
): Promise<string> {
  const bindable = await canBindPort(contract.appPort);
  if (bindable) {
    return `web did not become healthy on ${contract.appUrl} (${reason}); see ${webLogPath()}`;
  }
  return `app port ${contract.appPort} is claimed by another process; the environment is stopped/degraded. Free the port (or set APP_PORT), then run 'env:ensure --profile ${profile}' to recover.`;
}

interface RestartPreviousBuild {
  ok: boolean;
  recovery: string | null;
}

async function restartPreviousBuild(
  contract: Contract,
  stackName: string,
  profile: string,
): Promise<RestartPreviousBuild> {
  const restored = startWebServer({
    appPort: contract.appPort,
    appUrl: contract.appUrl,
    env: process.env,
    stackName,
    profile,
  });
  const waited = await waitForWeb(contract.appUrl, restored, 120);
  if (waited.ok) return { ok: true, recovery: null };
  stopWebServer();
  return {
    ok: false,
    recovery: await describeWebStartFailure(contract, waited.reason, profile),
  };
}

function resolveRuntime(options: {
  flag: RuntimeChoice | null;
  persisted: string | null;
  profile: string;
}): { runtime: RuntimeChoice; warnings: string[] } {
  const selected = selectRuntime(options.flag);
  const warnings: string[] = [];
  if (options.persisted && selected.explicit && options.persisted !== selected.runtime) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      [
        `this stack uses runtime=${options.persisted}, not ${selected.runtime}.`,
        'Runtime conversion is unavailable in phase 2; re-run with the persisted runtime:',
        `  bun run env:ensure --runtime ${options.persisted} ...`,
      ].join('\n'),
    );
  }
  const runtime = (options.persisted || selected.runtime) as RuntimeChoice;
  if (runtime === 'docker') warnings.push(dockerStackWarning());
  else assertNativeAvailable(options.profile);
  return { runtime, warnings };
}

function waitSecondsFor(explicit: number | null, cold: boolean): number {
  return explicit ?? (cold ? 180 : 60);
}

async function waitForCapabilities(
  capabilities: readonly Capability[],
  context: ReturnType<typeof probeContextFromStatus>,
  timeoutSeconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const probe = await probeCapabilities(capabilities, context);
    if (probe.ok) return true;
    if (Date.now() >= deadline) return false;
    await sleep(500);
  }
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function humanReady(
  ready: boolean,
  options: { profile: string; cold: boolean; appUrl: string },
): void {
  writeStderrLine('');
  writeStderrLine(
    `env: ensure ${ready ? 'ready' : 'not ready'} — profile=${options.profile} cold=${options.cold}`,
  );
  writeStderrLine(`  app      ${options.appUrl}`);
  writeStderrLine('  log      .dev/env.log');
}

function emit(
  parsed: ParsedCommand,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  options: {
    profile: string;
    cold: boolean;
    appUrl: string;
  },
): void {
  if (parsed.json) printJson(snapshot);
  else if (!parsed.quiet) humanReady(snapshot.ready, options);
}

/** Shared mode: reuse another checkout's stack with zero stack mutation. */
async function runSharedEnsure(
  parsed: ParsedCommand,
  options: NonNullable<ParsedCommand['ensure']>,
  contract: Contract,
  branch: string,
  appEnv: string,
): Promise<number> {
  const requested = [...buildCapabilities(options.profile, options.capabilityAtoms)];
  if (options.reconcile) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      'SUPABASE_SHARED=1: ensure never restarts or reconciles a stack this checkout does not own',
    );
  }
  const missingEnv = [
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `SUPABASE_SHARED=1 needs ${missingEnv.join(', ')} in .env.local (or the process environment)`,
    );
  }

  const lease = await resolveLease({
    contract,
    cliStackName: contract.stackName,
    branch,
    key: identityKey(REPO_ROOT, branch, contract.stackName ?? ''),
    explicitPort: options.appPort,
    serve: options.serve,
  });
  contract = lease.contract;
  const warnings: string[] = ['shared stack (owned by another checkout); no stack mutation'];
  const context = sharedProbeContext();
  const probe = await probeCapabilities(requested, context);
  if (!probe.ok) {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `the shared stack is not ready for profile '${options.profile}' (missing: ${probe.failed.join(', ')})`,
    );
  }

  const sharedEnv = {
    apiUrl: context.apiUrl,
    restUrl: `${context.apiUrl}/rest/v1`,
    dbUrl: process.env.SUPABASE_DB_URL ?? null,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    publishableKey: null,
    secretKey: null,
    mailUrl: context.mailUrl,
    studioUrl: context.studioUrl,
  };
  const envHash = buildEnvHash({
    supabaseUrl: sharedEnv.apiUrl,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
    anonKey: sharedEnv.anonKey ?? '',
  });

  let webPid = readWebPid();
  let webHttp = await probeHttp(contract.appUrl);
  if (options.build) {
    const buildState = readBuildState();
    const current =
      buildState &&
      buildState.envHash === envHash &&
      buildState.fingerprint ===
        computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash }) &&
      buildArtifactPresent();
    if (options.forceBuild || !current) {
      applyStackEnv(sharedEnv, { appUrl: contract.appUrl, appEnv });
      if (webPid) {
        const stopped = stopWebServer();
        if (!stopped.stopped) {
          throw new EnvFailure(
            EXIT_CONFLICT,
            `could not stop the web server (pid ${webPid}) for a safe rebuild`,
          );
        }
      }
      appendEnvLog('ensure(shared): building @studiq/web');
      const build = buildWithStableFingerprint({
        root: REPO_ROOT,
        mode: BUILD_MODE,
        envHash,
        env: process.env,
      });
      if (build.timedOut) {
        const restore = webPid
          ? await restartPreviousBuild(contract, contract.stackName ?? 'default', options.profile)
          : null;
        if (restore?.ok) {
          warnings.push('build timed out; restarted the previous build');
          writeStderrLine(
            `env: build timed out; the previous build is serving on ${contract.appUrl}`,
          );
        }
        throw new EnvFailure(
          EXIT_TIMEOUT,
          `timed out waiting for the cross-worktree build lock${restore && !restore.ok && restore.recovery ? `; ${restore.recovery}` : ''}`,
        );
      }
      if (!build.ok || !build.stable) {
        const restore = webPid
          ? await restartPreviousBuild(contract, contract.stackName ?? 'default', options.profile)
          : null;
        if (restore?.ok) {
          warnings.push('build failed; restarted the previous build');
          writeStderrLine(`env: build failed; the previous build is serving on ${contract.appUrl}`);
        }
        throw new EnvFailure(
          EXIT_START_FAILED,
          `${
            build.ok
              ? 'source changed while the build ran; re-run env:ensure to rebuild'
              : `build failed (exit ${build.exitCode ?? 'unknown'}); see .dev/env.log`
          }${restore && !restore.ok && restore.recovery ? `; ${restore.recovery}` : ''}`,
        );
      }
      writeBuildState({
        fingerprint: build.fingerprintAfter,
        envHash,
        mode: BUILD_MODE,
        builtAt: new Date().toISOString(),
      });
      webHttp = 0;
      webPid = null;
    }
  }

  if (options.serve) {
    await withCheckoutWebLock(async () => {
      let currentPid = readWebPid();
      let currentHttp = await probeHttp(contract.appUrl);
      const conflict = liveServerConflict(
        { stackName: contract.stackName ?? 'default', profile: options.profile },
        'start',
      );
      if (conflict) await refuseSecondServer(parsed, contract, conflict);
      if (!isWebHealthy(currentHttp)) {
        if (currentPid) {
          const stopped = stopWebServer();
          if (!stopped.stopped) {
            throw new EnvFailure(
              EXIT_CONFLICT,
              `could not stop the unhealthy web server (pid ${currentPid}) before restarting`,
            );
          }
          currentPid = null;
        }
        applyStackEnv(sharedEnv, { appUrl: contract.appUrl, appEnv });
        currentPid = startWebServer({
          appPort: contract.appPort,
          appUrl: contract.appUrl,
          env: process.env,
          stackName: contract.stackName ?? 'default',
          profile: options.profile,
        });
        const waited = await waitForWeb(contract.appUrl, currentPid, 120);
        currentHttp = waited.http;
        if (!waited.ok) {
          stopWebServer();
          throw new EnvFailure(
            EXIT_START_FAILED,
            await describeWebStartFailure(contract, waited.reason, options.profile),
          );
        }
      } else if (!currentPid) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `${contract.appUrl} answers but has no owned PID; refusing to overwrite a live server`,
        );
      }
      webPid = currentPid;
      webHttp = currentHttp;
    });
  }

  const ready = probe.ok && (!options.serve || isWebHealthy(webHttp));
  const updatedLease = touchLease(lease.lease, {
    appPort: contract.appPort,
    ownerPid: webPid ?? 0,
    mode: options.serve ? 'prod' : 'dev',
  });
  writeLease(updatedLease);
  const snapshot = await collectSnapshot({
    contract,
    stack: null,
    record: null,
    skipStackLookup: true,
    web: { pid: webPid, http: webHttp },
    supabaseHttp: probe.ok ? 200 : 0,
    ready,
    warnings,
    profile: options.profile,
    cold: false,
    seeded: false,
  });
  if (!parsed.json && !parsed.quiet) {
    for (const warning of warnings) writeStderrLine(`env: warning: ${warning}`);
  }
  emit(parsed, snapshot, { profile: options.profile, cold: false, appUrl: contract.appUrl });
  return ready ? 0 : 4;
}

export async function runEnsure(parsed: ParsedCommand): Promise<number> {
  const options = parsed.ensure;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'ensure options are missing');
  const appEnv = resolveLocalAppEnv();
  const baseContract = readContract();
  const branch = currentBranchRef();
  const cliStackName = options.stack ?? baseContract.stackName;
  const key = identityKey(REPO_ROOT, branch, cliStackName ?? '');
  const label = stackLabel(cliStackName);
  const requested = [...buildCapabilities(options.profile, options.capabilityAtoms)];

  appendEnvLog(
    `ensure: profile=${options.profile} stack=${label} serve=${options.serve} build=${options.build} shared=${baseContract.shared}`,
  );
  assertSeedingAllowed({
    mode: options.seed,
    profile: options.profile,
    shared: baseContract.shared,
  });

  if (options.serve || options.build) {
    const conflict = liveServerConflict(
      { stackName: cliStackName ?? 'default', profile: options.profile },
      'start',
    );
    if (conflict) return refuseSecondServer(parsed, baseContract, conflict);
  }

  if (baseContract.shared) {
    return runSharedEnsure(parsed, options, baseContract, branch, appEnv);
  }

  // ── 1. app-port lease ───────────────────────────────────────────────────
  const leaseResolution = await resolveLease({
    contract: baseContract,
    cliStackName,
    branch,
    key,
    explicitPort: options.appPort,
    serve: options.serve,
  });
  let contract = leaseResolution.contract;
  let lease = leaseResolution.lease;
  let dir = leaseResolution.dir;
  let projectId = leaseResolution.projectId;

  // ── 2. start lock ───────────────────────────────────────────────────────
  const lock = await acquireStartLock({
    key,
    projectRoot: REPO_ROOT,
    branch,
    stackName: cliStackName ?? '',
    waitSeconds: waitSecondsFor(options.waitSeconds, true),
    onHeartbeat: () => {
      try {
        const current = readLease(dir, projectId);
        if (current)
          writeLease(touchLease(current, { ownerPid: readWebPid() ?? current.ownerPid }));
      } catch {
        /* heartbeat only */
      }
    },
  });

  try {
    const adoption = readLease(dir, projectId);
    if (adoption?.appPort && !options.appPort && adoption.appPort !== contract.appPort) {
      contract = contractWithPort(contract, adoption.appPort);
      applyPort(contract);
    }
    lease = adoption ?? lease;
    dir = ensureRegistryDir();
    projectId = leaseProjectId(key);

    // ── 3/4. health + capability ──────────────────────────────────────────
    let record = readStackRecord(stateKeyFor(cliStackName));
    let stackRead: StackRead | null = null;
    let probeOk = false;
    let running = false;
    let probeContext = null as ReturnType<typeof probeContextFromStatus> | null;

    if (record && recordMatches(record, cliStackName, branch) && isStackRecordFresh(record)) {
      const warmProbe = await probeCapabilities(requested, probeContextFromRecord(record));
      if (warmProbe.ok) {
        probeOk = true;
        running = true;
        probeContext = probeContextFromRecord(record);
      } else {
        stackRead = readStack(cliStackName);
      }
    } else {
      stackRead = readStack(cliStackName);
    }

    if (stackRead) {
      running = true;
      probeContext = probeContextFromStatus(stackRead.status, stackRead.services);
      probeOk = (await probeCapabilities(requested, probeContext)).ok;
    }

    if (leaseResolution.pendingExplicitChange && running) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `this stack is already bound to app port ${lease.appPort}; stop it with 'env:down --all --yes' before changing --app-port`,
      );
    }

    const observed = running
      ? stackRead
        ? observedCapabilities(stackRead.services)
        : (record?.capabilities ?? [])
      : [];
    const decision = running
      ? capabilityDecision(observed, requested, options.reconcile)
      : ({ action: 'ready', missing: [] } as const);
    if (decision.action === 'conflict') {
      throw new EnvFailure(EXIT_CONFLICT, capabilityConflictMessage(decision.missing));
    }
    const restarted = decision.action === 'restart';
    const wasRunning = running;
    let cold = !wasRunning;

    const persistedRuntime =
      stackRead?.status.runtime || record?.runtime || readListedStackRuntime(cliStackName);
    if (persistedRuntime && persistedRuntime !== 'native' && persistedRuntime !== 'docker') {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `this stack uses unsupported runtime='${persistedRuntime}'; recreate it with --runtime native or docker`,
      );
    }
    const needsStart = !running || restarted || !probeOk;
    const warnings: string[] = [];
    let runtime: RuntimeChoice = (persistedRuntime as RuntimeChoice) || 'native';
    if (needsStart) {
      if (restarted && !parsed.yes && !(await confirm('Restart this stack in place? [y/N] '))) {
        throw new EnvFailure(
          2,
          'refusing to restart without confirmation (pass --yes when non-interactive)',
        );
      }
      const selection = resolveRuntime({
        flag: options.runtime,
        persisted: persistedRuntime,
        profile: options.profile,
      });
      runtime = selection.runtime;
      warnings.push(...selection.warnings);
    } else {
      const selection = selectRuntime(options.runtime);
      if (persistedRuntime && selection.explicit && persistedRuntime !== selection.runtime) {
        throw new EnvFailure(
          EXIT_CONFLICT,
          `this stack uses runtime=${persistedRuntime}, not ${selection.runtime}; runtime conversion is unavailable in phase 2 — re-run with --runtime ${persistedRuntime}`,
        );
      }
      if (runtime === 'docker') warnings.push(dockerStackWarning());
    }

    if (needsStart) {
      if (running) {
        appendEnvLog(`ensure: restarting stack ${label} (runtime=${runtime})`);
        const stopped = stopStack(cliStackName);
        if (!stopped.ok) {
          throw new EnvFailure(
            EXIT_START_FAILED,
            `could not stop this checkout's stack before restarting (${stopped.stderr.trim() || 'stack stop failed'})`,
          );
        }
        running = false;
      }
      if (runtime === 'docker') writeStderrLine(DOCKER_NOTICE);
      const pinPorts = Boolean(stackRead || record?.ports.api);
      const portSource = stackRead?.status.ports ?? record?.ports;
      const timeoutSeconds = waitSecondsFor(options.waitSeconds, cold);
      appendEnvLog(
        `ensure: starting stack ${label} profile=${options.profile} runtime=${runtime} cold=${cold}`,
      );
      const started = startStack({
        stackName: cliStackName,
        runtime,
        excludes: excludesFor(requested),
        pinPorts,
        ports: portSource,
        timeoutMs: (timeoutSeconds + 120) * 1000,
      });
      if (started.timedOut) {
        if (!wasRunning) stopStack(cliStackName);
        throw new EnvFailure(
          EXIT_TIMEOUT,
          `'supabase stack start' did not finish within ${timeoutSeconds + 120}s`,
        );
      }
      if (!started.ok) {
        if (!wasRunning) {
          stopStack(cliStackName);
          if (lease) removeLease(dir, projectId, lease.claimId);
        }
        throw new EnvFailure(
          EXIT_START_FAILED,
          `failed to start this checkout's stack (${started.stderr.trim() || 'supabase stack start failed'})`,
        );
      }
      const refreshed = readStack(cliStackName);
      if (!refreshed) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          "the stack started but 'supabase stack status' did not report endpoints",
        );
      }
      stackRead = refreshed;
      running = true;
      probeContext = probeContextFromStatus(refreshed.status, refreshed.services);
      probeOk = await waitForCapabilities(requested, probeContext, timeoutSeconds);
      if (!probeOk) {
        throw new EnvFailure(
          EXIT_TIMEOUT,
          `the stack did not become ready within ${timeoutSeconds}s (requested: ${requested.join(', ')})`,
        );
      }
      cold = !wasRunning;
    }

    if (stackRead) {
      record = recordFromStackRead(stackRead, {
        profile: options.profile,
        cold,
        previous: record,
        appUrl: contract.appUrl,
      });
    } else if (record) {
      record = recordFromExisting(record, { profile: options.profile, cold });
    }
    if (!record) {
      throw new EnvFailure(EXIT_START_FAILED, 'no stack record could be produced for this stack');
    }

    let envApplied = false;
    const ensureEnv = (): StackRead => {
      if (stackRead) {
        if (!envApplied) {
          applyStackEnv(stackRead.env, {
            appUrl: contract.appUrl,
            appEnv,
            stackId: stackRead.status.id,
          });
          envApplied = true;
        }
        return stackRead;
      }
      const read = readStack(cliStackName);
      if (!read) {
        throw new EnvFailure(
          EXIT_START_FAILED,
          'the stack is running but its connection values could not be read',
        );
      }
      stackRead = read;
      record = recordFromStackRead(read, {
        profile: options.profile,
        cold,
        previous: record,
        appUrl: contract.appUrl,
      });
      applyStackEnv(read.env, { appUrl: contract.appUrl, appEnv, stackId: read.status.id });
      envApplied = true;
      return read;
    };

    // ── 7. seed-marker check (tenant seeding is phase 3) ──────────────────
    const seeded = record.stackId ? seedMarkerCurrent(record.stackId) : false;

    // ── 8. build fingerprint ──────────────────────────────────────────────
    const webPidBefore = options.serve ? readWebPid() : null;
    if (options.build) {
      const envHash = record.envHash;
      let currentFingerprint: string | null = null;
      if (envHash) {
        const buildState = readBuildState();
        if (buildState && buildState.envHash === envHash) {
          const computed = computeBuildFingerprint({
            root: REPO_ROOT,
            mode: BUILD_MODE,
            envHash,
          });
          if (buildState.fingerprint === computed) currentFingerprint = computed;
        }
      }

      if (options.forceBuild || !currentFingerprint || !buildArtifactPresent()) {
        const read = ensureEnv();
        const effectiveEnvHash = buildEnvHash({
          supabaseUrl: read.env.apiUrl,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
          anonKey: read.env.anonKey ?? '',
        });
        if (webPidBefore) {
          appendEnvLog(`ensure: stopping web (pid ${webPidBefore}) for a safe rebuild`);
          const stopped = stopWebServer();
          if (!stopped.stopped) {
            throw new EnvFailure(
              EXIT_CONFLICT,
              `could not stop the web server (pid ${webPidBefore}) for a safe rebuild`,
            );
          }
        }
        appendEnvLog('ensure: building @studiq/web (fingerprint mismatch or --force-build)');
        const build = buildWithStableFingerprint({
          root: REPO_ROOT,
          mode: BUILD_MODE,
          envHash: effectiveEnvHash,
          env: process.env,
        });
        if (build.timedOut) {
          const restore = webPidBefore
            ? await restartPreviousBuild(contract, cliStackName ?? 'default', options.profile)
            : null;
          if (restore?.ok) {
            warnings.push('build timed out; restarted the previous build');
            writeStderrLine(
              `env: build timed out; the previous build is serving on ${contract.appUrl}`,
            );
          }
          throw new EnvFailure(
            EXIT_TIMEOUT,
            `timed out waiting for the cross-worktree build lock${restore && !restore.ok && restore.recovery ? `; ${restore.recovery}` : ''}`,
          );
        }
        if (!build.ok || !build.stable) {
          appendEnvLog(
            build.ok
              ? 'ensure: source changed while the build ran; not persisting the fingerprint'
              : `ensure: build failed (exit ${build.exitCode ?? 'unknown'})`,
          );
          const restore = webPidBefore
            ? await restartPreviousBuild(contract, cliStackName ?? 'default', options.profile)
            : null;
          if (restore?.ok) {
            warnings.push('build failed; restarted the previous build');
            writeStderrLine(
              `env: build failed; the previous build is serving on ${contract.appUrl}`,
            );
          }
          throw new EnvFailure(
            EXIT_START_FAILED,
            `${
              build.ok
                ? 'source changed while the build ran; re-run env:ensure to rebuild'
                : `build failed (exit ${build.exitCode ?? 'unknown'}); see .dev/env.log`
            }${restore && !restore.ok && restore.recovery ? `; ${restore.recovery}` : ''}`,
          );
        }
        writeBuildState({
          fingerprint: build.fingerprintAfter,
          envHash: effectiveEnvHash,
          mode: BUILD_MODE,
          builtAt: new Date().toISOString(),
        });
        record = { ...record, envHash: effectiveEnvHash };
      }
    }

    // ── 9. serve ─────────────────────────────────────────────────────────
    let webPid = readWebPid();
    let webHttp = await probeHttp(contract.appUrl);
    if (options.serve) {
      // Detection + claim + start are one checkout-wide critical section:
      // different stacks have different start locks, so this is what prevents
      // two concurrent ensures from both starting a server.
      await withCheckoutWebLock(async () => {
        let currentPid = readWebPid();
        let currentHttp = await probeHttp(contract.appUrl);
        const conflict = liveServerConflict(
          { stackName: cliStackName ?? 'default', profile: options.profile },
          'start',
        );
        if (conflict) await refuseSecondServer(parsed, contract, conflict);
        if (!isWebHealthy(currentHttp)) {
          if (currentPid) {
            const stopped = stopWebServer();
            if (!stopped.stopped) {
              throw new EnvFailure(
                EXIT_CONFLICT,
                `could not stop the unhealthy web server (pid ${currentPid}) before restarting`,
              );
            }
            currentPid = null;
          }
          ensureEnv();
          appendEnvLog(`ensure: starting web on ${contract.appUrl}`);
          currentPid = startWebServer({
            appPort: contract.appPort,
            appUrl: contract.appUrl,
            env: process.env,
            stackName: cliStackName ?? 'default',
            profile: options.profile,
          });
          const waited = await waitForWeb(contract.appUrl, currentPid, 120);
          currentHttp = waited.http;
          if (!waited.ok) {
            stopWebServer();
            throw new EnvFailure(
              EXIT_START_FAILED,
              await describeWebStartFailure(contract, waited.reason, options.profile),
            );
          }
        } else if (!currentPid) {
          throw new EnvFailure(
            EXIT_CONFLICT,
            `${contract.appUrl} answers but has no owned PID; refusing to overwrite a live server`,
          );
        }
        webPid = currentPid;
        webHttp = currentHttp;
      });
    }

    // ── 10. heartbeat + JSON ─────────────────────────────────────────────
    const finalProbe = probeContext
      ? await probeCapabilities(requested, probeContext)
      : { ok: false, failed: requested };
    const ready = finalProbe.ok && (!options.serve || isWebHealthy(webHttp));
    if (!ready) {
      throw new EnvFailure(
        EXIT_START_FAILED,
        `the stack is running but not ready for profile '${options.profile}' (failed: ${[...finalProbe.failed, ...(options.serve && !isWebHealthy(webHttp) ? ['web'] : [])].join(', ')})`,
      );
    }

    const updatedLease = touchLease(lease, {
      appPort: contract.appPort,
      apiPort: record.ports.api,
      dbPort: record.ports.db,
      studioPort: record.ports.studio,
      mailPort: record.ports.mail,
      analyticsPort: record.ports.analytics,
      edgeInspectorPort: record.ports.edgeInspector,
      poolerPort: record.ports.pooler,
      ownerPid: webPid ?? 0,
      mode: options.serve ? 'prod' : 'dev',
    });
    writeLease(updatedLease);
    record = recordFromExisting(record, { profile: options.profile, cold });
    writeStackRecord(key, record);

    const snapshot = await collectSnapshot({
      contract,
      stack: statusFromRecord(record),
      record,
      skipStackLookup: true,
      web: { pid: webPid, http: webHttp },
      supabaseHttp: 200,
      ready,
      warnings,
    });
    if (!parsed.json && !parsed.quiet) {
      for (const warning of warnings) writeStderrLine(`env: warning: ${warning}`);
    }
    emit(parsed, snapshot, { profile: options.profile, cold, appUrl: contract.appUrl });
    appendEnvLog(
      `ensure: ready profile=${options.profile} stack=${label} cold=${cold} seeded=${seeded}`,
    );
    return 0;
  } finally {
    lock.release();
  }
}
