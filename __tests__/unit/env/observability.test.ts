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
const baseline = { ...process.env };

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
