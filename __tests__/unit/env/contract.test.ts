import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface StatusSnapshot {
  ready: boolean;
  profile: string | null;
  cold: boolean | null;
  seeded: boolean | null;
  build: { present: boolean; fingerprint: string | null };
  ports: Record<string, unknown>;
  warnings: string[];
  [key: string]: unknown;
}

interface JsonModule {
  shapeStatus(inputs: Record<string, unknown>): StatusSnapshot;
}

interface ExitModule {
  EXIT_OK: number;
  EXIT_USAGE: number;
  EXIT_NATIVE_UNAVAILABLE: number;
  EXIT_START_FAILED: number;
  EXIT_TIMEOUT: number;
  EXIT_CONFLICT: number;
  EnvFailure: new (code: number, message: string) => Error & { exitCode: number };
}

interface ContractModule {
  contractWithPort(
    contract: {
      shared: boolean;
      sharedOwner: string | null;
      stackName: string | null;
      appPort: number;
      appUrl: string;
    },
    port: number,
  ): { appPort: number; appUrl: string };
}

const json = await loadEnvModule<JsonModule>('lib/json.ts');
const exit = await loadEnvModule<ExitModule>('lib/exit.ts');
const contract = await loadEnvModule<ContractModule>('lib/contract.ts');

const baseInputs = {
  contract: {
    shared: false,
    sharedOwner: null,
    stackName: null,
    appPort: 3011,
    appUrl: 'http://localhost:3011',
  },
  registryDir: '/tmp/studiq-dev-1000',
  projectId: 'stack-abcdef123456',
  mode: 'default',
  owner: null,
  stack: {
    id: 'abcdef1234567890',
    name: 'default',
    projectRoot: '/checkout',
    branch: 'refs/heads/feat/x',
    runtime: 'native',
    lifecycle: 'running',
    configDrift: 'unchanged',
    apiUrl: 'http://localhost:20041',
    dbUrl: 'postgresql://localhost:20042/postgres',
    studioUrl: null,
    mailUrl: null,
    ports: {
      api: 20041,
      db: 20042,
      studio: 0,
      mail: 0,
      mailSmtp: 0,
      mailPop3: 0,
      analytics: 0,
      edgeInspector: 0,
      pooler: 0,
      pgmeta: 20043,
    },
  },
  ports: {
    api: 20041,
    db: 20042,
    studio: 0,
    mail: 0,
    analytics: 0,
    edgeInspector: 0,
    shadow: 0,
    pooler: 0,
    mailSmtp: 0,
    mailPop3: 0,
    pgmeta: 20043,
  },
  urls: {
    supabase: 'http://localhost:20041',
    db: 'postgresql://localhost:20042/postgres',
    mail: null,
    studio: null,
  },
  web: { pid: 1234, http: 200 },
  supabaseHttp: 200,
  buildPresent: true,
};

describe('JSON contract and exit codes (spec §2.1, §9)', () => {
  it('fills lifecycle facts and keeps unknown values null, known false false', () => {
    const snapshot = json.shapeStatus({
      ...baseInputs,
      profile: 'api',
      cold: false,
      seeded: false,
      buildFingerprint: 'abc123',
      warnings: ['warning'],
      ready: true,
    });
    expect(snapshot.ready).toBe(true);
    expect(snapshot.profile).toBe('api');
    expect(snapshot.cold).toBe(false);
    expect(snapshot.seeded).toBe(false);
    expect(snapshot.build).toEqual({ present: true, fingerprint: 'abc123' });
    expect(snapshot.ports.block).toBeNull();
    expect(snapshot.warnings).toEqual(['warning']);
    expect('warmMs' in snapshot).toBe(false);
  });

  it('defaults lifecycle facts to null (unknown) for a read-only call', () => {
    const snapshot = json.shapeStatus(baseInputs);
    expect(snapshot.profile).toBeNull();
    expect(snapshot.cold).toBeNull();
    expect(snapshot.seeded).toBeNull();
    expect(snapshot.build).toEqual({ present: true, fingerprint: null });
  });

  it('keeps the legacy camelCase fields', () => {
    const snapshot = json.shapeStatus(baseInputs);
    for (const key of [
      'projectId',
      'worktree',
      'mode',
      'shared',
      'sharedOwner',
      'owner',
      'registry',
      'stackId',
      'branch',
      'urls',
      'web',
      'supabase',
      'dbUrl',
      'mailUrl',
      'log',
    ]) {
      expect(key in snapshot).toBe(true);
    }
    expect(snapshot.dbUrl).toBe('postgresql://localhost:20042/postgres');
  });

  it('uses the documented lifecycle exit codes', () => {
    expect([
      exit.EXIT_OK,
      exit.EXIT_USAGE,
      exit.EXIT_NATIVE_UNAVAILABLE,
      exit.EXIT_START_FAILED,
      exit.EXIT_TIMEOUT,
      exit.EXIT_CONFLICT,
    ]).toEqual([0, 2, 3, 4, 5, 6]);
    expect(new exit.EnvFailure(exit.EXIT_CONFLICT, 'conflict').exitCode).toBe(6);
  });

  it('changes only the app port in a derived contract URL', () => {
    const derived = contract.contractWithPort(
      {
        shared: false,
        sharedOwner: null,
        stackName: null,
        appPort: 3000,
        appUrl: 'http://localhost:3000',
      },
      3011,
    );
    expect(derived.appPort).toBe(3011);
    expect(derived.appUrl).toBe('http://localhost:3011');
  });
});
