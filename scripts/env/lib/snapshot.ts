import { readContractLenient, type Contract } from './contract';
import { contractWithLease } from './contract-lease';
import { probeHttp } from './health';
import { shapeStatus, type DiscoveredPorts, type StatusSnapshot } from './json';
import { readRegistry, findEntry, registryPathExists } from './registry';
import { REPO_ROOT, canon, currentBranchRef, deriveProjectId, sanitizeProjectId } from './repo';
import { probeStackStatus, readListedStackRuntime, type StackStatus } from './stack';
import { dockerStackWarning } from './platform';
import { identityKey, readBuildState, readStackRecord, type StackRecord } from './state';
import { seedMarkerCurrent } from './seed';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash, urlPort } from './urls';
import { readWebPid } from './web';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One snapshot builder for `status` and the lifecycle commands. It reads the
 * discovered stack, the `.dev/` record and the registry; callers can inject an
 * already-known stack/record so `ensure` never pays a second `stack status`.
 */
export interface SnapshotOptions {
  contract?: Contract;
  /** An already-read stack; `null` means "known to be absent". */
  stack?: StackStatus | null;
  record?: StackRecord | null;
  skipStackLookup?: boolean;
  web?: { pid: number | null; http: number };
  supabaseHttp?: number;
  ready?: boolean;
  warnings?: string[];
  // Lifecycle facts when there is no local record (shared mode).
  profile?: string | null;
  cold?: boolean | null;
  seeded?: boolean | null;
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

export function stateKeyFor(stackName: string | null): string {
  return identityKey(REPO_ROOT, currentBranchRef(), stackName ?? '');
}

export function statusFromRecord(record: StackRecord): StackStatus {
  return {
    id: record.stackId,
    name: record.name,
    projectRoot: record.projectRoot,
    branch: record.branch,
    runtime: record.runtime,
    lifecycle: 'running',
    configDrift: null,
    apiUrl: record.urls.supabase,
    dbUrl: record.urls.db,
    studioUrl: record.urls.studio,
    mailUrl: record.urls.mail,
    ports: record.ports,
  };
}

function envPort(value: string | undefined): number {
  if (!value) return 0;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function envUrl(value: string | undefined): string | null {
  if (!value) return null;
  return normalizeLocalhost(trimTrailingSlash(value));
}

interface Side {
  ports: DiscoveredPorts;
  supabaseUrl: string | null;
  dbUrl: string | null;
  mailUrl: string | null;
  studioUrl: string | null;
}

function portFromUrl(value: string | undefined): number {
  if (!value) return 0;
  const port = Number(urlPort(value) ?? '0');
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function sharedSide(): Side {
  return {
    ports: {
      ...EMPTY_PORTS,
      api: envPort(process.env.SUPABASE_API_PORT) || portFromUrl(process.env.SUPABASE_URL),
      db: envPort(process.env.SUPABASE_DB_PORT) || portFromUrl(process.env.SUPABASE_DB_URL),
      studio:
        envPort(process.env.SUPABASE_STUDIO_PORT) || portFromUrl(process.env.SUPABASE_STUDIO_URL),
      mail: envPort(process.env.SUPABASE_MAIL_PORT) || portFromUrl(process.env.SUPABASE_MAIL_URL),
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

function stackSide(stack: StackStatus | null): Side {
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
  if (explicit) {
    const sanitized = sanitizeProjectId(explicit);
    return sanitized || null;
  }
  return deriveProjectId() || null;
}

export async function collectSnapshot(options: SnapshotOptions = {}): Promise<StatusSnapshot> {
  const contract = options.contract ?? contractWithLease(readContractLenient());
  const registry = readRegistry();
  let probeError: string | null = null;
  let stack: StackStatus | null;
  if (options.stack !== undefined) {
    stack = options.stack;
  } else if (options.skipStackLookup || contract.shared) {
    stack = null;
  } else {
    const probe = probeStackStatus(contract.stackName);
    stack = probe.stack;
    probeError = probe.error;
  }
  const record = contract.shared
    ? null
    : options.record !== undefined
      ? options.record
      : readStackRecord(stateKeyFor(contract.stackName));
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
      : record
        ? `stack-${record.stackId.slice(0, 12)}`
        : null;
  const entry = contract.shared && projectId ? findEntry(registry.entries, projectId) : null;
  const entryWorktree = contract.shared ? (entry?.worktree ?? '') : '';
  const owner = entryWorktree && canon(entryWorktree) !== REPO_ROOT ? entryWorktree : null;
  const mode = contract.shared
    ? (entry?.mode ?? null)
    : statusStack
      ? statusStack.name || 'default'
      : (record?.name ?? null);

  const buildState = readBuildState();
  const warnings = [...(options.warnings ?? [])];
  if (probeError) {
    warnings.push(`cannot read 'supabase stack status': ${probeError}`);
  }
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
  const runtime = statusStack?.runtime ?? record?.runtime ?? listedRuntime ?? null;
  if (runtime === 'docker' && !contract.shared) warnings.push(dockerStackWarning());
  if (statusStack?.configDrift && statusStack.configDrift !== 'unchanged') {
    warnings.push('stack config drift: restart the stack to apply config.toml changes');
  }

  const seeded = options.seeded ?? (record?.stackId ? seedMarkerCurrent(record.stackId) : null);
  const profile = options.profile ?? record?.profile ?? null;

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
    buildPresent: existsSync(join(REPO_ROOT, 'apps', 'web', '.next', 'BUILD_ID')),
    profile,
    cold: options.cold ?? record?.cold ?? null,
    seeded,
    buildFingerprint: buildState?.fingerprint ?? null,
    warnings: [...new Set(warnings)],
    ready: options.ready,
    runtime,
    stackId: statusStack?.id ?? record?.stackId ?? null,
    branch: statusStack?.branch ?? record?.branch ?? null,
  });
}
