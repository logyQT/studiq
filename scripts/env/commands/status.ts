import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedCommand } from '../atoms';
import { readContract } from '../lib/contract';
import { probeHttp } from '../lib/health';
import { shapeStatus, type DiscoveredPorts, type StatusSnapshot } from '../lib/json';
import { printJson, writeLine } from '../lib/output';
import { findEntry, readRegistry } from '../lib/registry';
import { REPO_ROOT, canon, deriveProjectId, sanitizeProjectId } from '../lib/repo';
import { probeStackStatus, type StackStatus } from '../lib/stack';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from '../lib/urls';
import { readWebPid } from '../lib/web';

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

function envPort(value: string | undefined): number {
  if (!value) return 0;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function envUrl(value: string | undefined): string | null {
  if (!value) return null;
  return normalizeLocalhost(trimTrailingSlash(value));
}

interface StackSide {
  ports: DiscoveredPorts;
  supabaseUrl: string | null;
  dbUrl: string | null;
  mailUrl: string | null;
  studioUrl: string | null;
}

/** Shared mode: the stack belongs to another checkout, so only env values apply. */
function sharedSide(): StackSide {
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

function stackSide(stack: StackStatus | null): StackSide {
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

async function buildSnapshot(): Promise<StatusSnapshot> {
  const contract = readContract();
  const registry = readRegistry();
  const statusProbe = contract.shared
    ? { stack: null as StackStatus | null, error: null as string | null }
    : probeStackStatus(contract.stackName);
  const stack = statusProbe.stack;
  const side = contract.shared ? sharedSide() : stackSide(stack);

  const webPid = readWebPid();
  const webHttp = await probeHttp(contract.appUrl);
  const supabaseHttp = side.supabaseUrl ? await probeHttp(`${side.supabaseUrl}/auth/v1/health`) : 0;

  const projectId = contract.shared
    ? sharedProjectId()
    : stack
      ? `stack-${stack.id.slice(0, 12)}`
      : null;
  const entry = contract.shared && projectId ? findEntry(registry.entries, projectId) : null;
  const entryWorktree = contract.shared ? (entry?.worktree ?? '') : '';
  const owner = entryWorktree && canon(entryWorktree) !== REPO_ROOT ? entryWorktree : null;
  const mode = contract.shared ? (entry?.mode ?? null) : stack ? stack.name || 'default' : null;

  return shapeStatus({
    contract,
    registryDir: registry.dir,
    projectId,
    mode,
    owner,
    stack,
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
    warnings: statusProbe.error
      ? [`cannot read 'supabase stack status': ${statusProbe.error}`]
      : [],
  });
}

function orDash(value: string | number | null): string {
  if (value === null) return '-';
  if (value === '') return '-';
  return String(value);
}

function printHuman(snapshot: StatusSnapshot): void {
  let project: string;
  if (snapshot.shared) {
    project = `${orDash(snapshot.projectId)} (shared${snapshot.sharedOwner ? `: ${snapshot.sharedOwner}` : ''})`;
  } else if (snapshot.stack) {
    project = `stack ${snapshot.stack.id.slice(0, 12)}${snapshot.stack.name !== 'default' ? ` (${snapshot.stack.name})` : ''}${snapshot.stack.branch ? ` @ ${snapshot.stack.branch}` : ''}`;
  } else {
    project = '(stopped; no stack for this branch)';
  }

  writeLine(`ready       ${snapshot.ready}`);
  writeLine(`project     ${project}`);
  if (snapshot.runtime) writeLine(`runtime     ${snapshot.runtime}`);
  writeLine(`worktree    ${snapshot.worktree}`);
  writeLine(
    `web         ${snapshot.web.url}  http=${snapshot.web.http}  pid=${orDash(snapshot.web.pid)}`,
  );
  writeLine(`supabase    ${orDash(snapshot.supabase.url)}  http=${snapshot.supabase.http}`);
  writeLine(`db          ${orDash(snapshot.dbUrl)}`);
  writeLine(`mail        ${orDash(snapshot.mailUrl)}`);
  writeLine(`studio      ${orDash(snapshot.urls.studio)}`);
  writeLine(
    `ports       app=${snapshot.ports.app} api=${snapshot.ports.api} db=${snapshot.ports.db} studio=${snapshot.ports.studio} mail=${snapshot.ports.mail}`,
  );
  writeLine(`registry    ${snapshot.registry}`);
  if (snapshot.owner) writeLine(`owner       ${snapshot.owner}`);
}

export async function runStatus(parsed: ParsedCommand): Promise<number> {
  const snapshot = await buildSnapshot();
  if (parsed.json) printJson(snapshot);
  else printHuman(snapshot);
  return 0;
}
