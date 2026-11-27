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
async function healthyApiStack(
  harness: Harness,
): Promise<{ http: HttpServer; db: TcpListener; stackId: string }> {
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
  return { http, db, stackId: String(objectField(fixture, 'identity').id) };
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
  it('applies a pending version older than the newest applied one, then records the set', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    // A merge adds a file below the newest applied version (#1186): the CLI
    // refuses a plain `migration up` with "inserted before the last migration".
    harness.writeMigrationFiles(['20260101000000', '20261028100000', '20261030203549']);
    harness.setMigrationListFixture({
      migrations: [
        { local: '20260101000000', remote: '20260101000000', time: '2026-01-01 00:00:00' },
        { local: '20261028100000', remote: '', time: '2026-10-28 10:00:00' },
        { local: '20261030203549', remote: '20261030203549', time: '2026-10-30 20:35:49' },
      ],
    });
    harness.setMigrationListAfterFixture(
      applied(['20260101000000', '20261028100000', '20261030203549']),
    );
    harness.setMigrationUpFixture({
      applied: ['/repo/supabase/migrations/20261028100000_fixture.sql'],
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
    expect(calls).toContain('migration up --include-all --output-format json');
    expect(migrationsRecord(harness)).toMatchObject({
      versions: ['20260101000000', '20261028100000', '20261030203549'],
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
    expect(result.stderr).toContain('applying 1 pending migration(s) (20261125160000) failed');
    expect(result.stderr).toContain('relation "questions" already exists');
    expect(result.stderr).toContain("re-run 'bun run env:ensure'");
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
    expect(result.stderr).toContain('cannot apply 1 pending migration(s) (20261125160000)');
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

  it('re-probes after a repair so the record stops claiming remote-only versions', async () => {
    const harness = newHarness();
    const { stackId } = await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20260101000000']);
    // What an earlier ensure recorded when the file had already been deleted.
    harness.writeMigrationsRecord({
      stackId,
      versions: ['20260101000000'],
      remoteOnly: ['20260901000000'],
    });
    // `migration repair --status reverted 20260901000000` already ran.
    harness.setMigrationListFixture(applied(['20260101000000']));

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--app-port', String(appPort)],
      { APP_PORT: String(appPort) },
    );

    expect(result.status, result.stderr).toBe(0);
    // The covered local set is not enough: a drift claim needs a live answer.
    expect(harness.bunxCalls()).toContain('migration list --output-format json');
    expect(migrationsRecord(harness)).toMatchObject({
      versions: ['20260101000000'],
      remoteOnly: [],
    });

    const status = await harness.run(['status', '--json']);
    expect(status.status, status.stderr).toBe(0);
    expect(objectField(parseJsonObject(status.stdout), 'migrations')).toMatchObject({
      state: 'current',
      remoteOnly: [],
    });
  });

  it('never records a current claim when the migration list probe fails', async () => {
    const harness = newHarness();
    await healthyApiStack(harness);
    const appPort = await firstFreePort(appPortBase());
    harness.writeMigrationFiles(['20260101000000']);
    harness.setMigrationListFixture(
      {
        target: { kind: 'db-url', host: '127.0.0.1', port: 1 },
        _tag: 'Error',
        error: { code: 'DbConnectError', message: 'failed to connect to postgres' },
      },
      1,
    );

    const result = await harness.run(
      ['ensure', '--profile', 'api', '--no-seed', '--json', '--app-port', String(appPort)],
      { APP_PORT: String(appPort) },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('could not check the stack');
    expect(result.stderr).toContain('failed to connect to postgres');
    expect(existsSync(join(harness.stateDir, 'migrations.json'))).toBe(false);
    expect(objectField(parseJsonObject(result.stdout), 'migrations')).toMatchObject({
      state: 'unknown',
    });
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
