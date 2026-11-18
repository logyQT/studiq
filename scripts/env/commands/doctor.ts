import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedCommand } from '../atoms';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { probeHttp } from '../lib/health';
import { probePortBind } from '../lib/net';
import { pointerPath, readPointer } from '../lib/pointer';
import {
  grafanaAuthLabel,
  grafanaBaseUrl,
  grafanaTokenAge,
  inspectGrafana,
  type GrafanaAuthState,
} from '../lib/grafana';
import { OBSERVABILITY_PROJECT, OBSERVABILITY_URLS } from '../lib/observability';
import { formatBuildSlots, readBuildSlots } from '../lib/locks';
import {
  CACHE_KNOWN_EXCLUSIONS,
  cacheLayoutRecognised,
  cacheMaxBytes,
  checkCacheRoot,
  classifyCacheLayout,
  readCurrentSnapshotId,
  readLastPublish,
  readSnapshotStatus,
  resolveCacheDir,
  worktreeCacheDir,
  type CacheLayout,
} from '../lib/build-cache';
import { printJson, writeLine } from '../lib/output';
import { readRegistry, registryPathExists } from '../lib/registry';
import {
  REPO_ROOT,
  canon,
  composeFileNamesProject,
  currentBranchName,
  primaryCheckoutPath,
} from '../lib/repo';
import { probeStackStatus, readListedStackRuntime, type StackStatus } from '../lib/stack';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from '../lib/urls';
import { readWebPid } from '../lib/web';

export interface ObservabilityStatus {
  up: boolean;
  project: string;
  primary: string;
  /** The primary checkout's compose file already carries the fixed project name. */
  primaryReady: boolean;
  start: string;
  grafana: number;
  tempo: number;
  loki: number;
  prometheus: number;
  otlp: number;
  /** Whether agents can actually read Grafana (not just whether it answers). */
  auth: GrafanaAuthState;
  authDetail: string | null;
  tokenFile: string;
  tokenMintedAt: string | null;
  serviceAccount: string | null;
  role: string | null;
  mcpBinary: boolean;
}

export interface BuildCacheReport {
  root: string;
  /** Why the root is unusable; null when it is trusted. */
  problem: string | null;
  snapshot: ReturnType<typeof readSnapshotStatus>;
  lastPublish: ReturnType<typeof readLastPublish>;
  layout: string[] | null;
  /** Whether `.next/cache` is one the snapshot step may read. */
  layoutRecognised: boolean | null;
}

export interface DoctorReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  observability: ObservabilityStatus;
  cache: BuildCacheReport;
  lines: string[];
}

const OBSERVABILITY_PROBE_MS = 750;

function orDash(value: string | number | null): string {
  return value === null || value === '' ? '-' : String(value);
}

function httpLabel(value: number): string {
  return value > 0 ? String(value) : '-';
}

/**
 * The layout line: the entries on disk, and what a snapshot would leave out.
 *
 * An excluded entry is reported rather than hidden — "this file is here and will
 * not be copied" is the fact an operator needs when the snapshot step behaves
 * differently than the directory contents suggest.
 */
function layoutLabel(layout: CacheLayout | null): string {
  if (layout === null) return 'none (no apps/web/.next/cache yet)';
  const entries = layout.entries.join(', ');
  if (!cacheLayoutRecognised(layout)) {
    return `${entries} (unrecognised; known exclusions: ${CACHE_KNOWN_EXCLUSIONS.join(', ')})`;
  }
  return layout.known.length === 0
    ? `${entries} (recognised)`
    : `${entries} (recognised; not snapshotted: ${layout.known.join(', ')})`;
}

/**
 * `up`, `partial (n/total)` or `down` for the machine-wide stack.
 *
 * @public Used by the env unit tests, which load this module by a computed URL.
 */
export function observabilityLabel(upCount: number, total: number): string {
  if (upCount >= total) return 'up';
  return upCount > 0 ? `partial (${upCount}/${total})` : 'down';
}

function isWebHealthy(code: number): boolean {
  return code >= 200 && code < 400;
}

/**
 * Whether the cache root already holds published snapshot directories.
 *
 * A pointer that is missing while snapshots exist means a publish was interrupted
 * between the rename and the swap; the next publish prunes or restores it. One
 * `readdir`, no manifest read.
 */
function cacheRootHasSnapshots(cacheRoot: string): boolean {
  try {
    return readdirSync(join(cacheRoot, 'snapshots')).some(
      (name) => !['current', 'retired.json', 'last-publish.json', 'staging'].includes(name),
    );
  } catch {
    return false;
  }
}

function stackLines(stack: StackStatus | null): string[] {
  if (!stack)
    return ['  none for this branch — `bun run env:ensure --profile web` creates or resumes one'];
  const lines = [
    `  id         ${stack.id}`,
    `  name       ${stack.name}`,
    `  branch     ${stack.branch ?? 'unknown'}`,
    `  runtime    ${stack.runtime || 'unknown'}`,
    `  lifecycle  ${stack.lifecycle ?? 'unknown'}`,
    `  supabase   ${stack.apiUrl}`,
    `  db         ${orDash(stack.dbUrl)}`,
    `  studio     ${orDash(stack.studioUrl)}`,
    `  mail       ${orDash(stack.mailUrl)}`,
    `  drift      ${stack.configDrift ?? 'unknown'}`,
  ];
  return lines;
}

async function buildReport(): Promise<DoctorReport> {
  const contract = contractWithLease(readContract());
  const registry = readRegistry();
  // A missing registry is normal on a fresh machine; only an existing but
  // untrusted directory is worth a warning.
  const registryExists = registryPathExists(registry.dir);
  const trusted = registry.trusted;
  const statusProbe = contract.shared
    ? { stack: null as StackStatus | null, error: null as string | null }
    : probeStackStatus(contract.stackName);
  const stack = statusProbe.stack;
  // A running stack already reports its runtime; only a stopped/missing one
  // needs the `stack list` lookup (one status call on the running path).
  const listedRuntime =
    !contract.shared && !stack?.runtime ? readListedStackRuntime(contract.stackName) : null;
  // Read-only commands never choose or predict a runtime (phase 2 `ensure` owns
  // selection and exit 3). They report what the stack itself reports.
  const observedRuntime = stack?.runtime || listedRuntime || null;
  const runtimeSource = stack
    ? 'running stack'
    : listedRuntime
      ? 'persisted stack'
      : contract.shared
        ? 'shared stack (owned by another checkout; not inspected)'
        : 'none (no stack for this branch)';

  // Read-only: one shallow `readdir` plus the recorded cap. Reclamation belongs
  // to the admission path, so doctor reports staleness and never cleans it.
  const slots = readBuildSlots();
  // Read-only, like the slots: one pointer read, one manifest read, two shallow
  // `readdir`s. The cache root is validated without creating it.
  const cacheRoot = resolveCacheDir();
  const cacheRootProblem = checkCacheRoot(cacheRoot, REPO_ROOT, { create: false });
  const cacheSnapshot = readSnapshotStatus({ cacheDir: cacheRoot });
  const snapshotPointerMissing =
    cacheSnapshot === null && readCurrentSnapshotId(cacheRoot) === null
      ? cacheRootHasSnapshots(cacheRoot)
      : false;
  const lastPublish = readLastPublish(cacheRoot);
  const worktreeCacheLayout = classifyCacheLayout(worktreeCacheDir());
  const webPid = readWebPid();
  const webHttp = await probeHttp(contract.appUrl);
  // Same probe `env:ports` uses: a bind failure includes a listener on any
  // other interface, which a loopback connect probe would miss. Only
  // EADDRINUSE is a conflict; other bind errors are reported as warnings.
  const appPortProbe = await probePortBind(contract.appPort);
  const appPortBusy = appPortProbe.state === 'in-use';

  const sharedSupabaseUrl = contract.shared
    ? process.env.SUPABASE_URL
      ? normalizeLocalhost(trimTrailingSlash(process.env.SUPABASE_URL))
      : null
    : null;
  const supabaseUrl = stack?.apiUrl ?? sharedSupabaseUrl;
  const supabaseHttp = supabaseUrl ? await probeHttp(`${supabaseUrl}/auth/v1/health`) : 0;
  const sharedDbUrl = contract.shared
    ? stripDbCredentials(process.env.SUPABASE_DB_URL ?? '')
    : null;

  // Observability is machine-wide and owned by the primary checkout. Probe it
  // read-only so an agent in a worktree gets the start command that cannot
  // create a second stack.
  const primary = primaryCheckoutPath();
  // `GRAFANA_URL` is what the MCP actually talks to; it defaults to the
  // machine-wide stack. Probing the same URL keeps doctor honest for both.
  const grafanaBase = grafanaBaseUrl();
  const [grafana, tempo, loki, prometheus, otlp] = await Promise.all([
    probeHttp(`${grafanaBase}/api/health`, OBSERVABILITY_PROBE_MS),
    probeHttp(OBSERVABILITY_URLS.tempoReady, OBSERVABILITY_PROBE_MS),
    probeHttp(OBSERVABILITY_URLS.lokiReady, OBSERVABILITY_PROBE_MS),
    probeHttp(OBSERVABILITY_URLS.prometheusReady, OBSERVABILITY_PROBE_MS),
    probeHttp(OBSERVABILITY_URLS.otlp, OBSERVABILITY_PROBE_MS),
  ]);
  const primaryReady = composeFileNamesProject(
    join(primary, 'docker-compose.yml'),
    OBSERVABILITY_PROJECT,
  );
  // `/api/health` is unauthenticated: it proves the container answers, not that
  // an agent can read traces/logs. Validate the service-account token too.
  const grafanaAuth = await inspectGrafana({
    healthCode: grafana,
    healthTimeoutMs: OBSERVABILITY_PROBE_MS,
  });
  const upCount = [grafana, tempo, loki, prometheus, otlp].filter((code) => code > 0).length;
  const observability: ObservabilityStatus = {
    up: upCount === 5,
    project: OBSERVABILITY_PROJECT,
    primary,
    primaryReady,
    start: `cd "${primary}" && docker compose up -d`,
    grafana,
    tempo,
    loki,
    prometheus,
    otlp,
    auth: grafanaAuth.state,
    authDetail: grafanaAuth.detail,
    tokenFile: grafanaAuth.tokenFile,
    tokenMintedAt: grafanaAuth.mintedAt,
    serviceAccount: grafanaAuth.serviceAccount,
    role: grafanaAuth.role,
    mcpBinary: grafanaAuth.mcpBinary,
  };

  const problems: string[] = [];
  const warnings: string[] = [];

  // A stopped stack answers cleanly (exit 0, no API URL), so an error here means
  // the CLI itself could not be spawned or timed out — never "no stack".
  if (statusProbe.error) {
    warnings.push(`cannot read 'supabase stack status': ${statusProbe.error}`);
  }

  // Shared mode never starts a stack in this checkout, so a missing engine is
  // not a conflict; runtime availability is phase 2's job, not doctor's.
  if (stack && !contract.shared) {
    if (stack.projectRoot && canon(stack.projectRoot) !== REPO_ROOT) {
      problems.push(`stack identity belongs to another checkout (${stack.projectRoot})`);
    }
    if (supabaseHttp !== 200) {
      problems.push(`Supabase stack is running but ${stack.apiUrl}/auth/v1/health is not healthy`);
    }
    if (stack.configDrift && stack.configDrift !== 'unchanged') {
      warnings.push('stack config drift: restart the stack to apply config.toml changes');
    }
  }
  if (observedRuntime === 'docker') {
    warnings.push(
      'stack runtime=docker (compatibility mode); run `env:down --all` then `env:ensure` to recreate it',
    );
  }
  if (!trusted && registryExists) {
    warnings.push(
      `registry directory ${registry.dir} is not a trusted private directory; entries are ignored`,
    );
  }
  if (contract.shared && !sharedSupabaseUrl) {
    warnings.push(
      'SUPABASE_SHARED=1 but SUPABASE_URL is not exported to this unwrapped command (run `bun run env:check:quiet` for env checks; exit code only)',
    );
  }
  if (slots && slots.stale) {
    warnings.push(
      `${slots.stale} stale build slot(s): the next build kills the recorded group and frees the slot, and invalidates .next only for this checkout`,
    );
  }
  if (cacheRootProblem !== null) {
    warnings.push(`build cache: ${cacheRootProblem}; snapshots and seeds are refused`);
  }
  if (snapshotPointerMissing) {
    warnings.push(
      `build cache ${cacheRoot} holds snapshots but its 'current' pointer is missing; the next publish restores it`,
    );
  }
  if (lastPublish?.outcome === 'refused') {
    warnings.push(
      `last snapshot publish was refused: ${lastPublish.reason ?? 'unknown reason'} (the previous snapshot is kept)`,
    );
  }
  const cacheCapBytes = cacheMaxBytes();
  if (
    cacheCapBytes > 0 &&
    lastPublish?.sizeBytes != null &&
    lastPublish.sizeBytes > cacheCapBytes
  ) {
    warnings.push(
      `last snapshot was ${Math.round(lastPublish.sizeBytes / 1024 / 1024)} MB, over the ${Math.round(cacheCapBytes / 1024 / 1024)} MB cap (STUDIQ_CACHE_MAX_MB)`,
    );
  }
  if (worktreeCacheLayout !== null && !cacheLayoutRecognised(worktreeCacheLayout)) {
    warnings.push(
      `apps/web/.next/cache layout is unrecognised (${worktreeCacheLayout.entries.join(', ')}); the snapshot step and seeds are skipped until the allowlist matches`,
    );
  }
  if (slots?.degraded) {
    warnings.push(
      `build memory gate degraded (${slots.detail ?? 'the memory probe failed'}); concurrent builds are capped at 1`,
    );
  }
  if (appPortProbe.state === 'unavailable') {
    warnings.push(
      `cannot check app port ${contract.appPort}: ${appPortProbe.error ?? 'bind failed'} ` +
        '(not a listener conflict)',
    );
  }

  // Only a port that nothing in this contract can explain is a conflict. A pid
  // in `.dev/web.pid` alone is not proof the server serves APP_URL (the operator
  // may have changed the port), so the health probe decides.
  if (appPortBusy && !(webPid && isWebHealthy(webHttp))) {
    problems.push(`app port ${contract.appPort} is in use by another process`);
  }

  // The QA pointer is how a consumer worktree finds this app. Two failure modes
  // are worth a warning rather than a problem: a pointer that disagrees with
  // this checkout's own contract (the seeder and specs follow the pointer), and
  // one that names a stack this machine no longer has.
  const pointer = readPointer();
  if (pointer.state === 'invalid') {
    warnings.push(`qa pointer ${pointerPath()} is not readable: ${pointer.reason}`);
  } else if (pointer.state === 'ok') {
    const target = pointer.pointer;
    if (!contract.shared && target.appUrl !== contract.appUrl) {
      warnings.push(
        `qa pointer ${pointerPath()} points at ${target.appUrl}, not this checkout's ` +
          `${contract.appUrl}: the QA seeder and specs follow the pointer, env:* follows this checkout`,
      );
    }
    if (target.stackId && !registry.entries.some((entry) => entry.projectId === target.stackId)) {
      warnings.push(
        `qa pointer ${pointerPath()} names stack ${target.stackId.slice(0, 12)}, which is not in this machine's registry (stopped or owned by another machine)`,
      );
    }
  }

  const pointerLabel =
    pointer.state === 'absent'
      ? 'none'
      : pointer.state === 'invalid'
        ? `${pointerPath()} (unreadable)`
        : `${pointerPath()} → ${pointer.pointer.appUrl}` +
          `${pointer.pointer.stackId ? ` (${pointer.pointer.stackId.slice(0, 12)})` : ''}`;

  const lines: string[] = [
    '▸ Checkout',
    `  worktree   ${REPO_ROOT}`,
    `  branch     ${currentBranchName()}`,
    `  qa pointer ${pointerLabel}`,
    `  registry   ${registry.dir}${trusted || !registryExists ? '' : ' (untrusted — entries ignored)'}`,
  ];

  lines.push('', '▸ Local stack');
  if (contract.shared) {
    lines.push('  shared mode — this checkout does not own the stack (no start/stop/destroy)');
    lines.push(`  supabase   ${orDash(supabaseUrl)}  http=${supabaseHttp}`);
    lines.push(`  db         ${orDash(sharedDbUrl)}`);
  } else {
    lines.push(...stackLines(stack));
  }

  lines.push(
    '',
    '▸ App',
    `  port       ${contract.appPort} → ${contract.appUrl}`,
    `  web        http=${webHttp} pid=${orDash(webPid)}`,
  );

  lines.push('', '▸ Build slots');
  if (slots === null) {
    lines.push('  slots      unknown (no build has run in this checkout)');
  } else {
    lines.push(`  slots      ${formatBuildSlots(slots)}`);
    lines.push(
      `  cap        ${slots.cap ?? 'unknown'} (recorded when derived; never recomputed here)`,
    );
    lines.push(`  memory     ${slots.detail ?? (slots.degraded ? 'degraded' : 'ok')}`);
  }

  lines.push('', '▸ Build cache');
  lines.push(
    `  root       ${cacheRoot}${cacheRootProblem === null ? ' (trusted)' : ` (refused: ${cacheRootProblem})`}`,
  );
  if (cacheSnapshot === null) {
    lines.push('  snapshot   none (no published snapshot; every worktree builds cold)');
  } else {
    const size =
      cacheSnapshot.sizeBytes === null
        ? 'unknown'
        : `${(cacheSnapshot.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
    const files = cacheSnapshot.fileCount === null ? 'unknown' : `${cacheSnapshot.fileCount} files`;
    lines.push(`  snapshot   ${cacheSnapshot.id} — ${size}, ${files}`);
    lines.push(
      `  commit     ${cacheSnapshot.commit ?? 'unknown'} (at publish: ${cacheSnapshot.behindCommits ?? 'unknown'} behind origin/main)`,
    );
    lines.push(
      `  turbopack  ${cacheSnapshot.turbopack === null ? 'unknown' : cacheSnapshot.turbopack.join(', ') || 'none'}`,
    );
  }
  lines.push(`  layout     ${layoutLabel(worktreeCacheLayout)}`);
  if (lastPublish !== null) {
    lines.push(
      `  last       ${lastPublish.outcome}${lastPublish.reason ? ` (${lastPublish.reason})` : ''} at ${lastPublish.at}`,
    );
  }

  lines.push(
    '',
    '▸ Runtime',
    `  observed   ${observedRuntime ?? 'unknown (not observable here)'}`,
    `  source     ${runtimeSource}`,
    '  selection  read-only commands never choose a runtime (env:ensure, phase 2)',
  );

  const observabilityStatus = observabilityLabel(upCount, 5);
  const authLabel = grafanaAuthLabel({
    state: observability.auth,
    serviceAccount: observability.serviceAccount,
    role: observability.role,
    mintedAt: observability.tokenMintedAt,
  });
  const tokenAge = grafanaTokenAge(observability.tokenMintedAt);

  lines.push(
    '',
    '▸ Observability (machine-wide)',
    `  status     ${observabilityStatus}`,
    `  project    ${observability.project}`,
    `  primary    ${observability.primary}${observability.primaryReady ? '' : ' (compose file predates the fixed project name; update it first)'}`,
    `  grafana    http=${httpLabel(observability.grafana)}`,
    `  tempo      http=${httpLabel(observability.tempo)}`,
    `  loki       http=${httpLabel(observability.loki)}`,
    `  prometheus http=${httpLabel(observability.prometheus)}`,
    `  otlp       http=${httpLabel(observability.otlp)}`,
    `  auth       ${authLabel}`,
    `  token      ${observability.tokenFile}${tokenAge ? ` (minted ${tokenAge})` : ''}`,
    `  mcp        ${observability.mcpBinary ? 'mcp-grafana on PATH' : 'mcp-grafana NOT on PATH'}`,
    `  start      ${observability.start}`,
  );
  if (!observability.up) {
    lines.push('  note       start it once from the primary checkout, never from a worktree');
    lines.push(
      '  note       traces/logs are not readable by agents; do not substitute a local trace id',
    );
    if (!observability.primaryReady) {
      lines.push(`  note       update the primary first: git -C "${observability.primary}" pull`);
    }
    if (upCount > 0) {
      lines.push(
        '  note       a partial/legacy stack is holding a port; identify it with `docker compose ls` and stop that project from its own directory',
      );
    }
  } else if (observability.auth !== 'ok') {
    lines.push(
      '  note       the MCP token is not valid — run `bun run env:observability ensure`; do not substitute a local trace id',
    );
  }

  lines.push('', '▸ Ports');
  if (appPortProbe.state === 'unavailable') {
    lines.push(
      `  app        ${contract.appPort}  check failed (${appPortProbe.error ?? 'bind failed'})`,
    );
  } else if (appPortBusy && webPid && isWebHealthy(webHttp)) {
    lines.push(`  app        ${contract.appPort}  in use (this checkout)`);
  } else if (appPortBusy) {
    lines.push(`  app        ${contract.appPort}  in use (another process)`);
  } else {
    lines.push(`  app        ${contract.appPort}  free`);
  }
  if (contract.shared) {
    lines.push('  stack      dynamic (owned by the shared checkout)');
  } else if (stack) {
    lines.push(`  api        ${stack.ports.api}  in use (this stack)`);
    if (stack.ports.db) lines.push(`  db         ${stack.ports.db}  in use (this stack)`);
    if (stack.ports.studio) lines.push(`  studio     ${stack.ports.studio}  in use (this stack)`);
    if (stack.ports.mail) lines.push(`  mail       ${stack.ports.mail}  in use (this stack)`);
    if (stack.ports.mailSmtp)
      lines.push(`  mail-smtp  ${stack.ports.mailSmtp}  in use (this stack)`);
    if (stack.ports.mailPop3)
      lines.push(`  mail-pop3  ${stack.ports.mailPop3}  in use (this stack)`);
    if (stack.ports.pgmeta) lines.push(`  pgmeta     ${stack.ports.pgmeta}  in use (this stack)`);
    if (stack.ports.analytics) {
      lines.push(`  analytics  ${stack.ports.analytics}  in use (this stack)`);
    }
    if (stack.ports.edgeInspector) {
      lines.push(`  edge       ${stack.ports.edgeInspector}  in use (this stack)`);
    }
    if (stack.ports.pooler) lines.push(`  pooler     ${stack.ports.pooler}  in use (this stack)`);
  } else {
    lines.push('  stack      no stack ports (stack stopped)');
  }

  lines.push('', '▸ Registry');
  if (registry.entries.length === 0) {
    lines.push('  (no entries)');
  } else {
    for (const entry of registry.entries) {
      lines.push(`  ${entry.projectId.padEnd(48)} ${entry.worktree || '(unknown worktree)'}`);
    }
  }

  if (warnings.length > 0) {
    lines.push('', '▸ Warnings');
    for (const warning of warnings) lines.push(`  ⚠ ${warning}`);
  }

  if (problems.length > 0) {
    lines.push('', '▸ Next steps');
    for (const problem of problems) lines.push(`  ✘ ${problem}`);
    lines.push('  Pick a free APP_PORT: bun run env:ports');
    lines.push('  Start/repair:         bun run env:ensure --profile web');
  } else {
    lines.push('', '✔ No ownership or port conflicts for this checkout.');
  }

  const cache: BuildCacheReport = {
    root: cacheRoot,
    problem: cacheRootProblem,
    snapshot: cacheSnapshot,
    lastPublish,
    layout: worktreeCacheLayout === null ? null : worktreeCacheLayout.entries,
    layoutRecognised:
      worktreeCacheLayout === null ? null : cacheLayoutRecognised(worktreeCacheLayout),
  };

  return { ok: problems.length === 0, problems, warnings, observability, cache, lines };
}

export async function runDoctor(parsed: ParsedCommand): Promise<number> {
  const report = await buildReport();
  if (parsed.json) {
    printJson({
      ok: report.ok,
      problems: report.problems,
      warnings: report.warnings,
      observability: report.observability,
      cache: report.cache,
    });
  } else {
    for (const line of report.lines) writeLine(line);
  }
  return report.ok ? 0 : 1;
}
