import type { ParsedCommand, RuntimeChoice } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { contractWithPort, readContract, type Contract } from '../lib/contract';
import { assertNativeAvailable, selectRuntime } from '../lib/platform';
import { probePortBind } from '../lib/net';
import { probeHttp } from '../lib/health';
import { readRegistry } from '../lib/registry';
import { REPO_ROOT, canon, currentBranchRef } from '../lib/repo';
import { readListedStackRuntime, readStack, readStackList, type StackRead } from '../lib/stack';
import { applyStackEnv, startStack, stopStack } from '../lib/stack-lifecycle';
import {
  observedCapabilities,
  probeCapabilities,
  probeContextFromStatus,
  sharedProbeContext,
} from '../lib/capabilities';
import { buildCapabilities, excludesFor, missingCapabilities, type Capability } from '../profiles';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import { logBuildOutput, runProductionBuild } from '../lib/build';
import { pidAlive, withCheckoutLock } from '../lib/locks';
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
import {
  appendEnvLog,
  buildArtifactPresent,
  identityKey,
  readBuildState,
  readStackState,
  writeBuildState,
  writeStackState,
} from '../lib/state';
import { readWebPid, startWebServer, stopWebServer, waitForWeb, webLogPath } from '../lib/web';
import { liveServerConflict } from '../lib/web-owner';
import { refuseConflict } from '../lib/refusal';
import { collectSnapshot } from '../lib/snapshot';
import { assertSeedingAllowed, runSeeder } from '../lib/seed';
import { resolveLocalAppEnv, sharedStackEnv } from '../lib/app-env';
import { printJson, writeStderrLine } from '../lib/output';

const MIN_PORT = 3000;
const MAX_PORT = 3999;
const RESERVED = new Set([3010]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const healthy = (code: number) => code >= 200 && code < 400;

function withPort(contract: Contract, appPort: number): Contract {
  const next = contractWithPort(contract, appPort);
  process.env.APP_PORT = String(next.appPort);
  process.env.APP_URL = next.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= next.appUrl;
  return next;
}

async function freePort(port: number): Promise<boolean> {
  return port > 0 && (await probePortBind(port)).state === 'free';
}

async function resolveLease(
  contract: Contract,
  options: {
    stackName: string | null;
    branch: string;
    explicitPort: number | null;
    serve: boolean;
  },
): Promise<{ contract: Contract; lease: AppLease; dir: string; projectId: string }> {
  const key = identityKey(REPO_ROOT, options.branch, options.stackName ?? '');
  const projectId = leaseProjectId(key);
  const dir = readRegistry().dir;
  const existing = readLease(dir, projectId);
  const candidates: number[] = [];
  if (options.explicitPort) candidates.push(options.explicitPort);
  else if (existing?.appPort) candidates.push(existing.appPort);
  else candidates.push(contract.appPort || 3000);
  if (!options.explicitPort) {
    for (let port = MIN_PORT; port <= MAX_PORT; port += 1) {
      if (!RESERVED.has(port) && !candidates.includes(port)) candidates.push(port);
    }
  }
  let chosen = 0;
  for (const port of candidates) {
    if (port < 1 || port > 65535 || RESERVED.has(port)) continue;
    const registry = readRegistry();
    const foreign = registry.entries.find(
      (entry) => entry.projectId !== projectId && entry.appPort === port,
    );
    if (foreign && port !== existing?.appPort) {
      const raw = readLease(dir, foreign.projectId);
      const listed = raw ? readStackList() : null;
      const running =
        raw !== null &&
        (listed === null ||
          listed.some(
            (stack) =>
              canon(stack.projectRoot) === canon(raw.projectRoot) &&
              (stack.name || 'default') === (raw.stackName || 'default') &&
              stack.owner === 'reachable',
          ));
      const reclaimable =
        raw !== null &&
        listed !== null &&
        isLeaseReclaimable({
          pidAlive: pidAlive(raw.ownerPid),
          heartbeatAgeMs: heartbeatAgeMs(raw),
          ttlSec: raw.ttlSec,
          stackRunning: running,
        }) &&
        (await freePort(port));
      if (!reclaimable) {
        if (options.explicitPort) throw new EnvFailure(EXIT_CONFLICT, `app port ${port} is leased`);
        continue;
      }
      removeLease(dir, foreign.projectId);
    }
    if (port !== existing?.appPort && !(await freePort(port))) {
      if (options.explicitPort) throw new EnvFailure(EXIT_CONFLICT, `app port ${port} is in use`);
      continue;
    }
    chosen = port;
    break;
  }
  if (!chosen) throw new EnvFailure(EXIT_CONFLICT, `no free app port in ${MIN_PORT}-${MAX_PORT}`);
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

export async function runEnsure(parsed: ParsedCommand): Promise<number> {
  const options = parsed.ensure;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'ensure options are missing');
  const appEnv = resolveLocalAppEnv();
  const baseContract = readContract();
  const branch = currentBranchRef();
  const cliStackName = options.stack ?? baseContract.stackName;
  const requested = [...buildCapabilities(options.profile, options.capabilityAtoms)];
  const seed = assertSeedingAllowed({ mode: options.seed, shared: baseContract.shared });
  appendEnvLog(`ensure: profile=${options.profile} stack=${cliStackName ?? 'default'}`);

  // One lock per checkout: the app-port lease and the web claim are authoritative
  // while it is held. The build lock is taken later, inside this callback.
  return withCheckoutLock(async () => {
    // Refuse a second environment before claiming a port or writing state.
    if (options.build || options.serve) {
      const conflict = liveServerConflict(
        { stackName: cliStackName ?? 'default', profile: options.profile },
        'start',
      );
      if (conflict) return refuseConflict(parsed, baseContract, conflict);
    }

    const lease = await resolveLease(baseContract, {
      stackName: cliStackName,
      branch,
      explicitPort: options.appPort,
      serve: options.serve,
    });
    const contract = { ...lease.contract, stackName: cliStackName };
    const { dir, projectId } = lease;

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
      if (options.build) {
        const state = readBuildState();
        const current =
          state?.envHash === envHash &&
          state.fingerprint ===
            computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash }) &&
          buildArtifactPresent();
        if (options.forceBuild || !current) {
          if (readWebPid()) stopWebServer();
          const result = await runProductionBuild(envHash);
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
      }
      let webPid = readWebPid();
      let webHttp = await probeHttp(contract.appUrl);
      if (options.serve && (!healthy(webHttp) || !webPid)) {
        if (!healthy(webHttp) && webPid) stopWebServer();
        webPid = startWebServer({
          appPort: contract.appPort,
          appUrl: contract.appUrl,
          env: process.env,
        });
        const waited = await waitForWeb(contract.appUrl, webPid, 120);
        webHttp = waited.http;
        if (!waited.ok) {
          stopWebServer();
          throw new EnvFailure(EXIT_START_FAILED, `web did not start (${waited.reason})`);
        }
      }
      writeLease(touchLease(lease.lease, { appPort: contract.appPort, ownerPid: webPid ?? 0 }));
      const snapshot = await collectSnapshot({
        contract,
        stack: null,
        state: {
          stackName: contract.stackName ?? 'default',
          profile: options.profile,
          cold: false,
          updatedAt: '',
        },
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

    let stack = readStack(cliStackName);
    let running = stack !== null;
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
        stopStack(cliStackName);
        stack = null;
        running = false;
      }
    }
    let cold = false;
    if (!stack) {
      const runtime = runtimeFor(
        options.runtime,
        readListedStackRuntime(cliStackName),
        options.profile,
      );
      const timeout = (options.waitSeconds ?? 180) * 1000;
      if (running) stopStack(cliStackName);
      const result = startStack({
        stackName: cliStackName,
        runtime,
        excludes: excludesFor(requested),
        timeoutMs: timeout,
      });
      if (!result.ok) {
        stopStack(cliStackName);
        removeLease(dir, projectId);
        throw new EnvFailure(
          result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED,
          result.timedOut
            ? 'stack start timed out'
            : `failed to start stack: ${result.stderr.trim()}`,
        );
      }
      stack = readStack(cliStackName);
      if (!stack) throw new EnvFailure(EXIT_START_FAILED, 'stack started without endpoints');
      cold = !running;
      if (!(await waitReady(requested, stack, options.waitSeconds ?? 180))) {
        throw new EnvFailure(EXIT_TIMEOUT, 'stack did not become ready');
      }
    }

    applyStackEnv(stack.env, { appUrl: contract.appUrl, appEnv, stackId: stack.status.id });
    if (seed) runSeeder(options.profile, process.env);

    const envHash = buildEnvHash({
      supabaseUrl: stack.env.apiUrl,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
      anonKey: stack.env.anonKey ?? '',
    });
    let built = false;
    if (options.build) {
      const state = readBuildState();
      const current =
        state?.envHash === envHash &&
        state.fingerprint ===
          computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash }) &&
        buildArtifactPresent();
      if (options.forceBuild || !current) {
        if (readWebPid()) stopWebServer();
        const result = await runProductionBuild(envHash);
        if (!result.ok) {
          logBuildOutput(result.output);
          throw new EnvFailure(
            result.timedOut ? EXIT_TIMEOUT : EXIT_START_FAILED,
            result.timedOut
              ? 'timed out waiting for the build lock'
              : 'build failed; environment is stopped',
          );
        }
        writeBuildState({
          fingerprint: result.fingerprintAfter,
          envHash,
          builtAt: new Date().toISOString(),
        });
        built = true;
      }
    }

    let webPid = readWebPid();
    let webHttp = await probeHttp(contract.appUrl);
    if (options.serve && (built || !healthy(webHttp) || !webPid)) {
      if (!healthy(webHttp) && webPid) stopWebServer();
      webPid = startWebServer({
        appPort: contract.appPort,
        appUrl: contract.appUrl,
        env: process.env,
      });
      const waited = await waitForWeb(contract.appUrl, webPid, 120);
      webHttp = waited.http;
      if (!waited.ok) {
        stopWebServer();
        throw new EnvFailure(
          EXIT_START_FAILED,
          `web did not start (${waited.reason}); see ${webLogPath()}`,
        );
      }
    }

    const ready =
      (!options.serve || healthy(webHttp)) &&
      (await probeCapabilities(requested, probeContextFromStatus(stack.status))).ok;
    if (!ready) throw new EnvFailure(EXIT_START_FAILED, 'stack is not ready');
    writeStackState({
      stackName: stack.status.name,
      profile: options.profile,
      cold,
      updatedAt: new Date().toISOString(),
    });
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
    const snapshot = await collectSnapshot({
      contract,
      stack: stack.status,
      state: readStackState(),
      skipStackLookup: true,
      web: { pid: webPid, http: webHttp },
      supabaseHttp: 200,
      ready,
      profile: options.profile,
      cold,
    });
    emit(parsed, snapshot, options.profile, cold, contract.appUrl);
    return 0;
  });
}
