import { isCapabilitySuperset, missingCapabilities, type Capability } from '../profiles';
import { probeHttp } from './health';
import { portInUse } from './net';
import type { RecordedPorts, StackRecord } from './state';
import type { StackStatus } from './stack';
import { urlPort } from './urls';

/**
 * Readiness is capability-based (spec §5.2): every service the profile asks
 * for must answer. A requested service that is down means `ready: false`; a
 * running superset satisfies a narrower profile.
 */
export interface ProbeContext {
  apiUrl: string;
  dbPort: number;
  mailUrl: string | null;
  studioUrl: string | null;
  ports: RecordedPorts;
  /** Shared mode cannot inspect the database; the shared owner already proved it. */
  assumeDatabase?: boolean;
}

export function probeContextFromStatus(status: StackStatus): ProbeContext {
  return {
    apiUrl: status.apiUrl,
    dbPort: status.ports.db,
    mailUrl: status.mailUrl ?? (status.ports.mail ? `http://127.0.0.1:${status.ports.mail}` : null),
    studioUrl:
      status.studioUrl ?? (status.ports.studio ? `http://127.0.0.1:${status.ports.studio}` : null),
    ports: {
      api: status.ports.api,
      db: status.ports.db,
      studio: status.ports.studio,
      mail: status.ports.mail,
      mailSmtp: status.ports.mailSmtp,
      mailPop3: status.ports.mailPop3,
      analytics: status.ports.analytics,
      edgeInspector: status.ports.edgeInspector,
      pooler: status.ports.pooler,
      pgmeta: status.ports.pgmeta,
    },
  };
}

export function probeContextFromRecord(record: StackRecord): ProbeContext {
  return {
    apiUrl: record.urls.supabase,
    dbPort: record.ports.db,
    mailUrl:
      record.urls.mail ?? (record.ports.mail ? `http://127.0.0.1:${record.ports.mail}` : null),
    studioUrl:
      record.urls.studio ??
      (record.ports.studio ? `http://127.0.0.1:${record.ports.studio}` : null),
    ports: record.ports,
  };
}

function isOk(code: number): boolean {
  return code >= 200 && code < 400;
}

async function probeCapability(capability: Capability, context: ProbeContext): Promise<boolean> {
  if (!context.apiUrl) return false;
  switch (capability) {
    case 'database':
      return context.assumeDatabase === true
        ? true
        : context.dbPort > 0 && (await portInUse(context.dbPort));
    case 'rest':
      return isOk(await probeHttp(`${context.apiUrl}/rest/v1/`));
    case 'auth':
      return (await probeHttp(`${context.apiUrl}/auth/v1/health`)) === 200;
    case 'storage':
      return isOk(await probeHttp(`${context.apiUrl}/storage/v1/status`));
    case 'studio':
      return context.studioUrl ? isOk(await probeHttp(context.studioUrl)) : false;
    case 'mail':
      return context.mailUrl ? isOk(await probeHttp(context.mailUrl)) : false;
    case 'realtime':
      return context.ports.edgeInspector > 0
        ? portInUse(context.ports.edgeInspector)
        : isOk(await probeHttp(`${context.apiUrl}/realtime/v1/`));
    case 'functions':
      return context.ports.edgeInspector > 0
        ? portInUse(context.ports.edgeInspector)
        : isOk(await probeHttp(`${context.apiUrl}/functions/v1/`));
    case 'analytics':
      return context.ports.analytics > 0 && (await portInUse(context.ports.analytics));
    case 'pooler':
      return context.ports.pooler > 0 && (await portInUse(context.ports.pooler));
  }
}

export interface ProbeResult {
  ok: boolean;
  failed: Capability[];
}

/** Probe every requested capability in parallel; one failure fails readiness. */
export async function probeCapabilities(
  capabilities: Iterable<Capability>,
  context: ProbeContext,
): Promise<ProbeResult> {
  const requested = [...new Set(capabilities)];
  const results = await Promise.all(
    requested.map(async (capability) => ({
      capability,
      ok: await probeCapability(capability, context),
    })),
  );
  const failed = results.filter((entry) => !entry.ok).map((entry) => entry.capability);
  return { ok: failed.length === 0, failed };
}

/** Running services reported by `stack status` (composition members). */
export function observedCapabilities(services: ReadonlyArray<string>): Capability[] {
  const known = new Set<Capability>([
    'database',
    'rest',
    'auth',
    'storage',
    'studio',
    'realtime',
    'functions',
    'mail',
    'analytics',
    'pooler',
  ]);
  return [...new Set(services)].filter((service): service is Capability =>
    known.has(service as Capability),
  );
}

export type CapabilityAction = 'ready' | 'restart' | 'conflict';

export interface CapabilityDecision {
  action: CapabilityAction;
  missing: Capability[];
}

/**
 * Pure decision for the capability check: a superset is ready, adding
 * capabilities needs `--reconcile`, and never removing capabilities.
 */
export function capabilityDecision(
  observed: Iterable<Capability>,
  requested: Iterable<Capability>,
  reconcile: boolean,
): CapabilityDecision {
  if (isCapabilitySuperset(observed, requested)) return { action: 'ready', missing: [] };
  const missing = missingCapabilities(observed, requested);
  return { action: reconcile ? 'restart' : 'conflict', missing };
}

export function capabilityConflictMessage(missing: readonly Capability[]): string {
  const list = missing.join(', ');
  return [
    `this stack is running without the requested capability: ${list}.`,
    "Adding capabilities restarts this checkout's stack in place (data and endpoints are kept).",
    'Re-run with --reconcile (and --yes when non-interactive):',
    '  bun run env:ensure --profile <name> --reconcile --yes',
  ].join('\n');
}

/** Shared mode reads URLs/ports from the process environment, never the stack. */
export function sharedProbeContext(): ProbeContext {
  const apiUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const dbUrl = process.env.SUPABASE_DB_URL ?? '';
  const mailUrl = process.env.SUPABASE_MAIL_URL ?? process.env.MAILPIT_URL ?? null;
  const studioUrl = process.env.SUPABASE_STUDIO_URL ?? null;
  const dbPort = Number(urlPort(dbUrl) ?? process.env.SUPABASE_DB_PORT ?? '0') || 0;
  return {
    apiUrl,
    dbPort,
    mailUrl: mailUrl ? mailUrl.replace(/\/$/, '') : null,
    studioUrl: studioUrl ? studioUrl.replace(/\/$/, '') : null,
    assumeDatabase: true,
    ports: {
      api: Number(urlPort(apiUrl) ?? process.env.SUPABASE_API_PORT ?? '0') || 0,
      db: dbPort,
      studio: Number(process.env.SUPABASE_STUDIO_PORT ?? '0') || 0,
      mail: Number(urlPort(mailUrl ?? '') ?? process.env.SUPABASE_MAIL_PORT ?? '0') || 0,
      mailSmtp: 0,
      mailPop3: 0,
      analytics: 0,
      edgeInspector: 0,
      pooler: 0,
      pgmeta: 0,
    },
  };
}
