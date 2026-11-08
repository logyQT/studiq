import type { Contract } from './contract';
import { REPO_ROOT } from './repo';
import type { StackStatus } from './stack';

/**
 * The stable `--json` contract (spec §9).
 *
 * It is a superset of `dev:status --json`: every legacy camelCase field keeps
 * its name, discovered-but-absent values are `null` (never omitted), stopped
 * service ports are `0`, and nothing secret is ever included. Timing is not part
 * of the machine contract, so there is no `warmMs`.
 */
export interface StatusPorts {
  // Legacy order from `dev:status --json`.
  app: number;
  api: number;
  db: number;
  studio: number;
  mail: number;
  analytics: number;
  edgeInspector: number;
  shadow: number;
  pooler: number;
  // Phase-1 additions.
  block: null;
  mailSmtp: number;
  mailPop3: number;
  pgmeta: number;
}

export interface StatusSnapshot {
  ready: boolean;
  projectId: string | null;
  worktree: string;
  mode: string | null;
  shared: boolean;
  sharedOwner: string | null;
  owner: string | null;
  registry: string;
  stackId: string | null;
  runtime: string | null;
  branch: string | null;
  ports: StatusPorts;
  urls: {
    app: string;
    supabase: string | null;
    db: string | null;
    mail: string | null;
    studio: string | null;
  };
  web: { url: string; pid: number | null; http: number };
  supabase: { url: string | null; http: number };
  dbUrl: string | null;
  mailUrl: string | null;
  profile: string | null;
  cold: boolean | null;
  stack: {
    id: string;
    name: string;
    branch: string | null;
    projectRoot: string;
  } | null;
  seeded: boolean | null;
  build: { present: boolean; fingerprint: string | null };
  warnings: string[];
  log: string;
}

export type DiscoveredPorts = Omit<StatusPorts, 'app' | 'block'>;

export interface StatusInputs {
  contract: Contract;
  registryDir: string;
  projectId: string | null;
  mode: string | null;
  owner: string | null;
  stack: StackStatus | null;
  ports: DiscoveredPorts;
  urls: {
    supabase: string | null;
    db: string | null;
    mail: string | null;
    studio: string | null;
  };
  web: { pid: number | null; http: number };
  supabaseHttp: number;
  buildPresent: boolean;
  // Lifecycle facts (phase 2); all default to "unknown" for read-only calls.
  profile?: string | null;
  cold?: boolean | null;
  seeded?: boolean | null;
  buildFingerprint?: string | null;
  ready?: boolean;
  runtime?: string | null;
  stackId?: string | null;
  branch?: string | null;
  /** CLI/probe warnings, plumbed by every snapshot builder. */
  warnings: string[];
}

/** `200-399` for the web app and a healthy Supabase, exactly like `dev:status`. */
function isReady(webHttp: number, supabaseHttp: number): boolean {
  return webHttp >= 200 && webHttp < 400 && supabaseHttp === 200;
}

export function shapeStatus(inputs: StatusInputs): StatusSnapshot {
  const { contract, stack } = inputs;
  return {
    ready: inputs.ready ?? isReady(inputs.web.http, inputs.supabaseHttp),
    projectId: inputs.projectId,
    worktree: REPO_ROOT,
    mode: inputs.mode,
    shared: contract.shared,
    sharedOwner: contract.sharedOwner,
    owner: inputs.owner,
    registry: inputs.registryDir,
    stackId: inputs.stackId ?? stack?.id ?? null,
    runtime: inputs.runtime ?? stack?.runtime ?? null,
    branch: inputs.branch ?? stack?.branch ?? null,
    ports: {
      app: contract.appPort,
      api: inputs.ports.api,
      db: inputs.ports.db,
      studio: inputs.ports.studio,
      mail: inputs.ports.mail,
      analytics: inputs.ports.analytics,
      edgeInspector: inputs.ports.edgeInspector,
      shadow: inputs.ports.shadow,
      pooler: inputs.ports.pooler,
      block: null,
      mailSmtp: inputs.ports.mailSmtp,
      mailPop3: inputs.ports.mailPop3,
      pgmeta: inputs.ports.pgmeta,
    },
    urls: {
      app: contract.appUrl,
      supabase: inputs.urls.supabase,
      db: inputs.urls.db,
      mail: inputs.urls.mail,
      studio: inputs.urls.studio,
    },
    web: { url: contract.appUrl, pid: inputs.web.pid, http: inputs.web.http },
    supabase: { url: inputs.urls.supabase, http: inputs.supabaseHttp },
    dbUrl: inputs.urls.db,
    mailUrl: inputs.urls.mail,
    profile: inputs.profile ?? null,
    cold: inputs.cold ?? null,
    stack: stack
      ? {
          id: stack.id,
          name: stack.name,
          branch: stack.branch,
          projectRoot: stack.projectRoot,
        }
      : null,
    seeded: inputs.seeded ?? null,
    build: {
      present: inputs.buildPresent,
      fingerprint: inputs.buildFingerprint ?? null,
    },
    warnings: inputs.warnings ?? [],
    log: '.dev/env.log',
  };
}
