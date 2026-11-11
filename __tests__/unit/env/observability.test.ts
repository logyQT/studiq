import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface StackEnv {
  apiUrl: string;
  restUrl: string | null;
  dbUrl: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  publishableKey: string | null;
  secretKey: string | null;
  mailUrl: string | null;
  studioUrl: string | null;
}

interface StackLifecycleModule {
  applyStackEnv(env: StackEnv, extras: { appUrl: string; appEnv: string; stackId?: string }): void;
  observabilityServiceName(branch: string, stackId?: string): string;
}

const lifecycle = await loadEnvModule<StackLifecycleModule>('lib/stack-lifecycle.ts');
const repo = await loadEnvModule<{
  composeFileNamesProject(path: string, project: string): boolean;
}>('lib/repo.ts');
const doctor = await loadEnvModule<{
  observabilityLabel(upCount: number, total: number): string;
}>('commands/doctor.ts');
const baseline = { ...process.env };
const tempDirs: string[] = [];

const stackEnv: StackEnv = {
  apiUrl: 'http://localhost:54321',
  restUrl: null,
  dbUrl: null,
  anonKey: null,
  serviceRoleKey: null,
  publishableKey: null,
  secretKey: null,
  mailUrl: null,
  studioUrl: null,
};

beforeEach(() => {
  delete process.env.OTEL_SERVICE_NAME;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in baseline)) delete process.env[key];
  }
  Object.assign(process.env, baseline);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('observability service name', () => {
  it('uses the branch slug so one collector can tell worktrees apart', () => {
    expect(lifecycle.observabilityServiceName('feat/x')).toBe('studiq-feat-x');
    expect(lifecycle.observabilityServiceName('Chore/Review Skills')).toBe(
      'studiq-chore-review-skills',
    );
  });

  it('falls back to the stack id on a detached HEAD', () => {
    expect(lifecycle.observabilityServiceName('detached', 'abcdef12-3456')).toBe(
      'studiq-stack-abcdef12-345',
    );
    expect(lifecycle.observabilityServiceName('', '')).toBe('studiq');
  });
});

function composeFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-compose-'));
  tempDirs.push(dir);
  const path = join(dir, 'docker-compose.yml');
  writeFileSync(path, contents);
  return path;
}

describe('composeFileNamesProject', () => {
  it('accepts a real name line, quoted or not', () => {
    expect(
      repo.composeFileNamesProject(
        composeFile('name: studiq-observability\n'),
        'studiq-observability',
      ),
    ).toBe(true);
    expect(
      repo.composeFileNamesProject(
        composeFile("name: 'studiq-observability'\n"),
        'studiq-observability',
      ),
    ).toBe(true);
  });

  it('rejects comments, other projects and unreadable paths', () => {
    expect(
      repo.composeFileNamesProject(
        composeFile('# name: studiq-observability\nname: studiq\n'),
        'studiq-observability',
      ),
    ).toBe(false);
    expect(
      repo.composeFileNamesProject(composeFile('name: something-else\n'), 'studiq-observability'),
    ).toBe(false);
    expect(repo.composeFileNamesProject('/does/not/exist', 'studiq-observability')).toBe(false);
  });
});

describe('observabilityLabel', () => {
  it('distinguishes up, partial and down', () => {
    expect(doctor.observabilityLabel(5, 5)).toBe('up');
    expect(doctor.observabilityLabel(1, 5)).toBe('partial (1/5)');
    expect(doctor.observabilityLabel(0, 5)).toBe('down');
  });
});

describe('applyStackEnv observability defaults', () => {
  it('points the app at the machine-wide collector and names the checkout', () => {
    lifecycle.applyStackEnv(stackEnv, {
      appUrl: 'http://localhost:3000',
      appEnv: 'test',
      stackId: 'stack-123',
    });

    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:4318');
    expect(process.env.OTEL_SERVICE_NAME).toMatch(/^studiq-[a-z0-9-]+$/);
  });

  it('preserves an explicit service name and endpoint from .env.local', () => {
    process.env.OTEL_SERVICE_NAME = 'custom-service';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel.example:4318';

    lifecycle.applyStackEnv(stackEnv, { appUrl: 'http://localhost:3000', appEnv: 'test' });

    expect(process.env.OTEL_SERVICE_NAME).toBe('custom-service');
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://otel.example:4318');
  });
});
