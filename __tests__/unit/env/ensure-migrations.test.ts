import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appPortBase,
  createHarness,
  firstFreePort,
  objectField,
  parseJsonObject,
  stackStatusFixture,
  startHttpServer,
  startTcpListener,
  type Harness,
  type HttpServer,
  type TcpListener,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];
const closers: Array<{ close(): Promise<void> | void }> = [];

afterEach(async () => {
  for (const closer of closers.splice(0).toReversed()) await closer.close();
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/**
 * A running `api` stack whose capability probes answer: the HTTP fixture serves
 * rest/auth/storage and the TCP listener stands in for the database port.
 */
async function healthyApiStack(harness: Harness): Promise<{ http: HttpServer; db: TcpListener }> {
  const http = await startHttpServer(200);
  const db = await startTcpListener(0, '127.0.0.1');
  closers.push(http, db);
  const fixture = stackStatusFixture({
    apiUrl: http.url,
    apiPort: http.port,
    dbUrl: `postgresql://postgres:postgres@127.0.0.1:${db.port}/postgres`,
  });
  fixture.composition = {
    members: [
      { service: 'database' },
      { service: 'rest' },
      { service: 'auth' },
      { service: 'storage' },
    ],
  };
  const endpoints = objectField(fixture, 'endpoints');
  endpoints['database.sql'] = { port: db.port };
  harness.setStatusFixture(fixture);
  return { http, db };
}

function applied(versions: readonly string[]): { migrations: Array<Record<string, string>> } {
  return {
    migrations: versions.map((version) => ({
      local: version,
      remote: version,
      time: '2026-11-27 10:00:00',
    })),
  };
}

function pending(version: string): { migrations: Array<Record<string, string>> } {
  return {
    migrations: [{ local: version, remote: '', time: '2026-11-27 10:00:00' }],
  };
}

function migrationsRecord(harness: Harness): Record<string, unknown> {
  const path = join(harness.stateDir, 'migrations.json');
  return parseJsonObject(readFileSync(path, 'utf8'));
}

describe('env:ensure applies migrations the stack is missing (#1186)', () => {
  it('applies the pending version, proves it with a re-probe, and records the set', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20260101000000', '20261125160000']);
    harness.setMigrationListFixture({
      migrations: [
        { local: '20260101000000', remote: '20260101000000', time: '2026-01-01 00:00:00' },
        { local: '20261125160000', remote: '', time: '2026-11-25 16:00:00' },
      ],
    });
    harness.setMigrationListAfterFixture(applied(['20260101000000', '20261125160000']));
    harness.setMigrationUpFixture({
      applied: ['/repo/supabase/migrations/20261125160000_fixture.sql'],
      message: 'Migrations applied',
    });

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      { APP_PORT: String(appPort) },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('env: applied 1 pending migration(s)');
    const calls = harness.bunxCalls();
    expect(calls).toContain('migration list --output-format json');
    expect(calls).toContain('migration up --output-format json');
    expect(migrationsRecord(harness)).toMatchObject({
      versions: ['20260101000000', '20261125160000'],
      remoteOnly: [],
    });
  });

  it('fails the ensure when the migration cannot be applied', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20261125160000']);
    harness.setMigrationListFixture(pending('20261125160000'));
    harness.setMigrationUpFixture(
      {
        target: { kind: 'db-url', host: '127.0.0.1', port: 1 },
        _tag: 'Error',
        error: { code: 'DbExecError', message: 'relation "questions" already exists' },
      },
      1,
    );

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      { APP_PORT: String(appPort) },
    );

    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('applying 1 pending migration(s) failed');
    expect(result.stderr).toContain('relation "questions" already exists');
    expect(existsSync(join(harness.stateDir, 'migrations.json'))).toBe(false);
  });

  it('refuses to apply while the database records a version with no local file', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20261125160000']);
    harness.setMigrationListFixture({
      migrations: [
        { local: '20261125160000', remote: '', time: '2026-11-25 16:00:00' },
        { local: '', remote: '20990101000000', time: '2099-01-01 00:00:00' },
      ],
    });

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      { APP_PORT: String(appPort) },
    );

    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('records 1 version(s) with no local file');
    expect(result.stderr).toContain('20990101000000');
    expect(result.stderr).toContain('migration repair');
    // `migration up` would refuse this state itself; do not spawn it.
    expect(harness.bunxCalls()).not.toContain('migration up');
  });

  it('reports a remote-only version without failing and records it', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20260101000000']);
    harness.setMigrationListFixture({
      migrations: [
        { local: '20260101000000', remote: '20260101000000', time: '2026-01-01 00:00:00' },
        { local: '', remote: '20990101000000', time: '2099-01-01 00:00:00' },
      ],
    });

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      { APP_PORT: String(appPort) },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('1 migration version(s) with no local file');
    expect(migrationsRecord(harness)).toMatchObject({ remoteOnly: ['20990101000000'] });
  });

  it('does not open the database again when the record covers the local set', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20260101000000']);
    harness.setMigrationListFixture(applied(['20260101000000']));

    const args = ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)];
    const first = await harness.run(args, { APP_PORT: String(appPort) });
    expect(first.status, first.stderr).toBe(0);
    const calls = harness.bunxCalls();
    expect(calls).toContain('migration list');

    const second = await harness.run(args);

    expect(second.status, second.stderr).toBe(0);
    expect(harness.bunxCalls()).toBe(calls);
  });
});

describe('env:ensure never mutates a shared stack', () => {
  it('reports pending migrations and runs no migration up', async () => {
    const harness = newHarness();
    const http = await startHttpServer(200);
    const db = await startTcpListener(0, '127.0.0.1');
    closers.push(http, db);
    harness.writeMigrationFiles(['20261125160000']);
    harness.setMigrationListFixture(pending('20261125160000'));

    const result = await harness.run(['ensure', '--profile', 'api', '--no-seed', '--json'], {
      SUPABASE_SHARED: '1',
      SUPABASE_URL: http.url,
      SUPABASE_DB_URL: `postgresql://postgres:postgres@127.0.0.1:${db.port}/postgres`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'shared-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'shared-service',
      APP_PORT: String(await firstFreePort(appPortBase())),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('shared stack has 1 pending migration(s)');
    expect(harness.bunxCalls()).toContain('migration list');
    expect(harness.bunxCalls()).not.toContain('migration up');
    expect(parseJsonObject(result.stdout)).toHaveProperty('migrations.state', 'pending');
    expect(existsSync(join(harness.stateDir, 'migrations.json'))).toBe(false);
  });

  it('never probes the local target when the shared database URL is absent', async () => {
    const harness = newHarness();
    const http = await startHttpServer(200);
    closers.push(http);

    const result = await harness.run(['ensure', '--profile', 'api', '--no-seed', '--json'], {
      SUPABASE_SHARED: '1',
      SUPABASE_URL: http.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'shared-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'shared-service',
      APP_PORT: String(await firstFreePort(appPortBase())),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('migration state is unknown');
    expect(harness.bunxCalls()).not.toContain('migration list');
    expect(parseJsonObject(result.stdout)).toHaveProperty('migrations.state', 'unknown');
  });
});
