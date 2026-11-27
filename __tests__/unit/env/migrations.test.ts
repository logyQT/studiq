import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface MigrationsReport {
  state: string;
  pending: string[];
  remoteOnly: string[];
  checkedAt: string | null;
  source: string;
  reason: string | null;
}

interface MigrationsState {
  stackId: string;
  stackName: string;
  checkedAt: string;
  versions: string[];
  remoteOnly: string[];
}

interface MigrationProbe {
  ok: boolean;
  pending: string[];
  remoteOnly: string[];
  reason: string | null;
}

interface MigrationsModule {
  localMigrationVersions(dir?: string): string[];
  parseMigrationList(stdout: string): { local: string; remote: string }[] | null;
  probeReport(probe: MigrationProbe, checkedAt: string): MigrationsReport;
  classifyMigrations(
    record: MigrationsState | null,
    local: string[],
    stackId: string | null,
  ): MigrationsReport;
}

const migrations = await loadEnvModule<MigrationsModule>('lib/migrations.ts');

const dirs: string[] = [];

function migrationDir(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-migrations-'));
  dirs.push(dir);
  for (const file of files) writeFileSync(join(dir, file), 'select 1;\n');
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function state(versions: readonly string[], remoteOnly: readonly string[] = []): MigrationsState {
  return {
    stackId: 'stack-a',
    stackName: 'default',
    checkedAt: '2026-11-27T10:00:00.000Z',
    versions: [...versions],
    remoteOnly: [...remoteOnly],
  };
}

describe('local migration files', () => {
  it('reads only 14-digit .sql names, sorted, and ignores everything else', () => {
    const dir = migrationDir([
      '20261125160000_problem_questions_bank_link.sql',
      '20260101000000_init.sql',
      'notes.md',
      '2026010100000_short.sql',
      '20260101000001_ok.sql.bak',
    ]);
    mkdirSync(join(dir, '20260102000000_directory.sql'));

    expect(migrations.localMigrationVersions(dir)).toEqual(['20260101000000', '20261125160000']);
  });

  it('answers with an empty set when the directory does not exist', () => {
    expect(migrations.localMigrationVersions(join(tmpdir(), 'studiq-missing-migrations'))).toEqual(
      [],
    );
  });
});

describe('supabase migration list output', () => {
  it('reads paired, pending and remote-only rows', () => {
    const parsed = migrations.parseMigrationList(
      JSON.stringify({
        migrations: [
          { local: '20260101000000', remote: '20260101000000', time: '2026-01-01 00:00:00' },
          { local: '20261125160000', remote: '', time: '2026-11-25 16:00:00' },
          { local: '', remote: '20261126000000', time: '2026-11-26 00:00:00' },
        ],
        message: 'Migrations listed',
      }),
    );

    expect(parsed).toEqual([
      { local: '20260101000000', remote: '20260101000000' },
      { local: '20261125160000', remote: '' },
      { local: '', remote: '20261126000000' },
    ]);
  });

  it('rejects anything that is not the documented JSON object', () => {
    expect(migrations.parseMigrationList('Target: local stack')).toBeNull();
    expect(migrations.parseMigrationList('{"migrations":"none"}')).toBeNull();
    expect(migrations.parseMigrationList('[]')).toBeNull();
  });
});

describe('migration reports', () => {
  it('names pending versions, remote-only versions, and the clean case', () => {
    const pending = migrations.probeReport(
      { ok: true, pending: ['20261125160000'], remoteOnly: [], reason: null },
      '2026-11-27T10:00:00.000Z',
    );
    expect(pending.state).toBe('pending');
    expect(pending.pending).toEqual(['20261125160000']);
    expect(pending.source).toBe('probe');

    const drift = migrations.probeReport(
      { ok: true, pending: [], remoteOnly: ['20261126000000'], reason: null },
      '2026-11-27T10:00:00.000Z',
    );
    expect(drift.state).toBe('drift');
    expect(drift.remoteOnly).toEqual(['20261126000000']);

    const current = migrations.probeReport(
      { ok: true, pending: [], remoteOnly: [], reason: null },
      '2026-11-27T10:00:00.000Z',
    );
    expect(current.state).toBe('current');
  });

  it('reads a failed probe as unknown with its reason, never as clean', () => {
    const unknown = migrations.probeReport(
      { ok: false, pending: [], remoteOnly: [], reason: 'connection refused' },
      '2026-11-27T10:00:00.000Z',
    );

    expect(unknown.state).toBe('unknown');
    expect(unknown.reason).toBe('connection refused');
  });
});

describe('classifyMigrations', () => {
  const local = ['20260101000000', '20261125160000'];

  it('is unknown without a record for this stack', () => {
    expect(migrations.classifyMigrations(null, local, 'stack-a').state).toBe('unknown');
    expect(migrations.classifyMigrations(state(local), local, 'stack-b').state).toBe('unknown');
    expect(migrations.classifyMigrations(state(local), local, null).state).toBe('unknown');
  });

  it('reports a local version the record does not cover as pending', () => {
    const report = migrations.classifyMigrations(state(['20260101000000']), local, 'stack-a');

    expect(report.state).toBe('pending');
    expect(report.pending).toEqual(['20261125160000']);
    expect(report.source).toBe('record');
  });

  it('reports current when the record covers exactly the local set', () => {
    expect(migrations.classifyMigrations(state(local), local, 'stack-a').state).toBe('current');
  });

  it('reports a recorded version with no local file as drift', () => {
    const report = migrations.classifyMigrations(
      state(local, ['20261126000000']),
      local,
      'stack-a',
    );

    expect(report.state).toBe('drift');
    expect(report.remoteOnly).toEqual(['20261126000000']);
  });

  it('stops trusting a record whose local set shrank', () => {
    const report = migrations.classifyMigrations(state(local), ['20260101000000'], 'stack-a');

    expect(report.state).toBe('unknown');
    expect(report.reason).toContain('changed since the last probe');
  });
});
