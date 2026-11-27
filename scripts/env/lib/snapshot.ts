import { relative } from 'node:path';
import { readContractLenient, type Contract } from './contract';
import { contractWithLease } from './contract-lease';
import { envPort } from './env-port';
import { probeHttp } from './health';
import { shapeStatus, type DiscoveredPorts, type StatusSnapshot } from './json';
import { buildInProgress, readBuildSlots } from './locks';
import { readSnapshotStatus } from './build-cache';
import { manifestReport } from './manifest';
import { readRegistry, findEntry, registryPathExists } from './registry';
import {
  REPO_ROOT,
  canon,
  currentBranchName,
  currentCommit,
  deriveProjectId,
  sanitizeProjectId,
} from './repo';
import { profileRequiresServe } from '../profiles';
import {
  absentMigrations,
  classifyMigrations,
  localMigrationVersions,
  unknownMigrations,
  type MigrationsReport,
} from './migrations';
import { probeStackStatus, readListedStackRuntime, type StackStatus } from './stack';
import {
  buildArtifactDir,
  buildArtifactPresent,
  classifyRecordedArtifact,
  failedBuildArtifacts,
  readBuildState,
  readMigrationsState,
  readStackState,
  type StackState,
} from './state';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from './urls';
import { readWebPid } from './web';

export interface SnapshotOptions {
  contract?: Contract;
  stack?: StackStatus | null;
  state?: StackState | null;
  skipStackLookup?: boolean;
  web?: { pid: number | null; http: number };
  supabaseHttp?: number;
  ready?: boolean;
  warnings?: string[];
  profile?: string | null;
  cold?: boolean | null;
  /** A report the caller already proved (ensure), instead of the recorded claim. */
  migrations?: MigrationsReport;
  /**
   * Test seam: the artifact `build.state`/`build.present` describe. Production
   * uses `apps/web/.next`; the unit tests point this at a temporary directory.
   */
  artifactDir?: string;
}

const EMPTY_PORTS: DiscoveredPorts = {
  api: 0,
  db: 0,
  studio: 0,
  mail: 0,
  analytics: 0,
  edgeInspector: 0,
  shadow: 0,
  pooler: 0,
  mailSmtp: 0,
  mailPop3: 0,
  pgmeta: 0,
};

function envUrl(value: string | undefined): string | null {
  return value ? normalizeLocalhost(trimTrailingSlash(value)) : null;
}

function sharedSide() {
  return {
    ports: {
      ...EMPTY_PORTS,
      api: envPort(process.env.SUPABASE_API_PORT),
      db: envPort(process.env.SUPABASE_DB_PORT),
      studio: envPort(process.env.SUPABASE_STUDIO_PORT),
      mail: envPort(process.env.SUPABASE_MAIL_PORT),
      analytics: envPort(process.env.SUPABASE_ANALYTICS_PORT),
      edgeInspector: envPort(process.env.SUPABASE_EDGE_INSPECTOR_PORT),
      shadow: envPort(process.env.SUPABASE_SHADOW_PORT),
      pooler: envPort(process.env.SUPABASE_POOLER_PORT),
    },
    supabaseUrl: envUrl(process.env.SUPABASE_URL),
    dbUrl: stripDbCredentials(process.env.SUPABASE_DB_URL ?? ''),
    mailUrl: envUrl(process.env.SUPABASE_MAIL_URL),
    studioUrl: envUrl(process.env.SUPABASE_STUDIO_URL),
  };
}

function stackSide(stack: StackStatus | null) {
  if (!stack) {
    return { ports: EMPTY_PORTS, supabaseUrl: null, dbUrl: null, mailUrl: null, studioUrl: null };
  }
  return {
    ports: {
      api: stack.ports.api,
      db: stack.ports.db,
      studio: stack.ports.studio,
      mail: stack.ports.mail,
      analytics: stack.ports.analytics,
      edgeInspector: stack.ports.edgeInspector,
      shadow: 0,
      pooler: stack.ports.pooler,
      mailSmtp: stack.ports.mailSmtp,
      mailPop3: stack.ports.mailPop3,
      pgmeta: stack.ports.pgmeta,
    },
    supabaseUrl: stack.apiUrl,
    dbUrl: stack.dbUrl,
    mailUrl: stack.mailUrl,
    studioUrl: stack.studioUrl,
  };
}

function sharedProjectId(): string | null {
  const explicit = process.env.SUPABASE_PROJECT_ID ?? '';
  if (explicit) return sanitizeProjectId(explicit) || null;
  return deriveProjectId() || null;
}

export async function collectSnapshot(options: SnapshotOptions = {}): Promise<StatusSnapshot> {
  const contract = options.contract ?? contractWithLease(readContractLenient());
  const registry = readRegistry();
  let probeError: string | null = null;
  let stack: StackStatus | null;
  if (options.stack !== undefined) stack = options.stack;
  else if (options.skipStackLookup || contract.shared) stack = null;
  else {
    const probe = probeStackStatus(contract.stackName);
    stack = probe.stack;
    probeError = probe.error;
  }
  const state = options.state !== undefined ? options.state : readStackState();
  const side = contract.shared ? sharedSide() : stackSide(stack);
  const webPid = options.web ? options.web.pid : readWebPid();
  const webProbe = options.web ? Promise.resolve(options.web.http) : probeHttp(contract.appUrl);
  const supabaseProbe =
    options.supabaseHttp !== undefined
      ? Promise.resolve(options.supabaseHttp)
      : side.supabaseUrl
        ? probeHttp(`${side.supabaseUrl}/auth/v1/health`)
        : Promise.resolve(0);
  const [webHttp, supabaseHttp] = await Promise.all([webProbe, supabaseProbe]);

  const statusStack = contract.shared ? null : stack;
  const projectId = contract.shared
    ? sharedProjectId()
    : statusStack
      ? `stack-${statusStack.id.slice(0, 12)}`
      : null;
  const entry = contract.shared && projectId ? findEntry(registry.entries, projectId) : null;
  const owner = entry?.worktree && canon(entry.worktree) !== REPO_ROOT ? entry.worktree : null;
  const mode = contract.shared
    ? (entry?.mode ?? null)
    : statusStack
      ? statusStack.name || 'default'
      : (state?.stackName ?? null);
  const warnings = [...(options.warnings ?? [])];
  if (probeError) warnings.push(`cannot read 'supabase stack status': ${probeError}`);
  if (!registry.trusted && registryPathExists(registry.dir)) {
    warnings.push(
      `registry directory ${registry.dir} exists but is not a trusted private directory; ` +
        'ownership cannot be verified',
    );
  }
  const listedRuntime =
    !contract.shared && !statusStack && !options.skipStackLookup
      ? readListedStackRuntime(contract.stackName)
      : null;
  const profile = options.profile ?? state?.profile ?? null;
  const fallbackReady =
    profile && !profileRequiresServe(profile)
      ? supabaseHttp === 200
      : webHttp >= 200 && webHttp < 400 && supabaseHttp === 200;
  const record = readBuildState();
  const artifactDir = options.artifactDir ?? buildArtifactDir();
  const cacheSnapshot = readSnapshotStatus();
  warnings.push(...(cacheSnapshot?.warnings ?? []));
  const buildState = classifyRecordedArtifact(artifactDir);
  const slots = readBuildSlots();
  const runtime = statusStack?.runtime ?? listedRuntime;
  // The status call failed: its id/running answers are unknown, not "absent".
  // The runtime can still be known when the separate `stack list` answered.
  const stackProbeFailed = !contract.shared && probeError !== null;
  const commit = currentCommit();
  const branch = currentBranchName();
  // A live probe costs a database connection, so the snapshot reports this
  // checkout's last proven apply against the local files. The caller that
  // probes (ensure) passes its own report; doctor probes separately.
  const migrations =
    options.migrations ??
    (contract.shared
      ? unknownMigrations('the shared stack is owned by another checkout')
      : statusStack
        ? classifyMigrations(readMigrationsState(), localMigrationVersions(), statusStack.id)
        : absentMigrations());

  return shapeStatus({
    contract,
    registryDir: registry.dir,
    projectId,
    mode,
    owner,
    stack: statusStack,
    ports: side.ports,
    urls: {
      supabase: side.supabaseUrl,
      db: side.dbUrl,
      mail: side.mailUrl,
      studio: side.studioUrl,
    },
    web: { pid: webPid, http: webHttp },
    supabaseHttp,
    commit,
    buildPresent: buildArtifactPresent(artifactDir),
    buildState,
    buildFailed: failedBuildArtifacts(artifactDir).map((path) => relative(REPO_ROOT, path)),
    buildSlots: slots,
    snapshot: cacheSnapshot,
    migrations,
    profile,
    cold: options.cold ?? state?.cold ?? null,
    buildFingerprint: record?.fingerprint ?? null,
    warnings: [...new Set(warnings)],
    ready: options.ready ?? fallbackReady,
    runtime,
    // The manifest is the cheap path an agent reads without running anything;
    // this report is the reconciler. Status never writes the file (ADR-0011 §1).
    manifest: manifestReport({
      appPort: contract.appPort,
      appUrl: contract.appUrl,
      webPid,
      stackId: contract.shared
        ? projectId
        : stackProbeFailed
          ? undefined
          : (statusStack?.id ?? null),
      // A failed probe is unknown, never "the stack is down". This is the call
      // (#1360) the file exists to avoid, so its failure cannot be its accuser.
      stackRunning: contract.shared ? true : stackProbeFailed ? null : statusStack !== null,
      runtime: stackProbeFailed && listedRuntime === null ? undefined : runtime,
      buildState,
      fingerprint: record?.fingerprint ?? null,
      building: buildInProgress(),
      branch,
      commit,
    }),
  });
}
