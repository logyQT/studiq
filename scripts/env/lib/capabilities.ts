import type { Capability } from '../profiles';
import { probeHttp } from './health';
import { portAcceptsConnections } from './net';
import type { StackPorts, StackStatus } from './stack';
import { urlPort } from './urls';

export interface ProbeContext {
  apiUrl: string;
  dbPort: number;
  mailUrl: string | null;
  studioUrl: string | null;
  ports: StackPorts;
  assumeDatabase?: boolean;
}

export function probeContextFromStatus(status: StackStatus): ProbeContext {
  return {
    apiUrl: status.apiUrl,
    dbPort: status.ports.db,
    mailUrl: status.mailUrl ?? (status.ports.mail ? `http://127.0.0.1:${status.ports.mail}` : null),
    studioUrl:
      status.studioUrl ?? (status.ports.studio ? `http://127.0.0.1:${status.ports.studio}` : null),
    ports: status.ports,
  };
}

function ok(code: number): boolean {
  return code >= 200 && code < 400;
}

async function probe(capability: Capability, context: ProbeContext): Promise<boolean> {
  if (!context.apiUrl) return false;
  switch (capability) {
    case 'database':
      return context.assumeDatabase === true
        ? true
        : context.dbPort > 0 && (await portAcceptsConnections(context.dbPort));
    case 'rest':
      return ok(await probeHttp(`${context.apiUrl}/rest/v1/`));
    case 'auth':
      return (await probeHttp(`${context.apiUrl}/auth/v1/health`)) === 200;
    case 'storage':
      return ok(await probeHttp(`${context.apiUrl}/storage/v1/status`));
    case 'studio':
      return context.studioUrl ? ok(await probeHttp(context.studioUrl)) : false;
    case 'mail':
      return context.mailUrl ? ok(await probeHttp(context.mailUrl)) : false;
    case 'realtime':
      return context.ports.realtime > 0 && (await portAcceptsConnections(context.ports.realtime));
    case 'functions':
      return context.ports.edgeInspector > 0
        ? portAcceptsConnections(context.ports.edgeInspector)
        : ok(await probeHttp(`${context.apiUrl}/functions/v1/`));
    case 'analytics':
      return context.ports.analytics > 0 && (await portAcceptsConnections(context.ports.analytics));
    case 'pooler':
      return context.ports.pooler > 0 && (await portAcceptsConnections(context.ports.pooler));
  }
}

export async function probeCapabilities(
  capabilities: Iterable<Capability>,
  context: ProbeContext,
): Promise<{ ok: boolean; failed: Capability[] }> {
  const requested = [...new Set(capabilities)];
  const failed: Capability[] = [];
  await Promise.all(
    requested.map(async (capability) => {
      if (!(await probe(capability, context))) failed.push(capability);
    }),
  );
  return { ok: failed.length === 0, failed };
}

export function observedCapabilities(services: readonly string[]): Capability[] {
  const known = new Set<Capability>([
    'database',
    'rest',
    'auth',
    'storage',
    'studio',
    'mail',
    'realtime',
    'functions',
    'analytics',
    'pooler',
  ]);
  return [...new Set(services)].filter((service): service is Capability =>
    known.has(service as Capability),
  );
}

/** A shared-mode TCP port from the environment; 0 when unset or invalid. */
function envPort(value: string | undefined): number {
  const port = Number(value ?? '0');
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

export function sharedProbeContext(): ProbeContext {
  const apiUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const mailUrl = process.env.SUPABASE_MAIL_URL ?? process.env.MAILPIT_URL ?? null;
  const studioUrl = process.env.SUPABASE_STUDIO_URL ?? null;
  return {
    apiUrl,
    dbPort: Number(urlPort(process.env.SUPABASE_DB_URL ?? '') ?? '0') || 0,
    mailUrl: mailUrl?.replace(/\/$/, '') ?? null,
    studioUrl: studioUrl?.replace(/\/$/, '') ?? null,
    assumeDatabase: true,
    ports: {
      api: 0,
      db: 0,
      studio: 0,
      mail: 0,
      mailSmtp: 0,
      mailPop3: 0,
      // Shared stacks publish these as plain port variables; an unset value
      // stays 0 so the readiness probe fails instead of probing port 0.
      realtime: envPort(process.env.SUPABASE_REALTIME_PORT),
      analytics: envPort(process.env.SUPABASE_ANALYTICS_PORT),
      edgeInspector: 0,
      pooler: 0,
      pgmeta: 0,
    },
  };
}
