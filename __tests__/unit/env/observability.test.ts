import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  mailSmtpPort: number | null;
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
type Probe = 'grafana' | 'tempo' | 'loki' | 'prometheus' | 'otlp';
const doctor = await loadEnvModule<{
  observabilityLabel(upCount: number, total: number): string;
  isObservabilityProbeHealthy(probe: Probe, code: number): boolean;
  observabilityHealth(codes: Record<Probe, number>): {
    healthy: number;
    answering: number;
    up: boolean;
  };
  observabilitySummary(
    codes: Record<Probe, number>,
    options: { primary: string; primaryReady: boolean; authOk: boolean },
  ): { up: boolean; label: string; notes: string[] };
}>('commands/doctor.ts');

const OBSERVABILITY_PORT_KEYS = [
  'grafana',
  'prometheus',
  'loki',
  'tempo',
  'otlpGrpc',
  'otlpHttp',
  'prometheusExporter',
] as const;

type ObservabilityPort = (typeof OBSERVABILITY_PORT_KEYS)[number];

const observability = await loadEnvModule<{
  OBSERVABILITY_PORTS: Record<ObservabilityPort, number>;
}>('lib/observability.ts');

/** The container-side port each service listens on; only the host side moves. */
const CONTAINER_PORTS: Record<ObservabilityPort, number> = {
  grafana: 3000,
  prometheus: 9090,
  loki: 3100,
  tempo: 3200,
  otlpGrpc: 4317,
  otlpHttp: 4318,
  prometheusExporter: 8889,
};

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
  mailSmtpPort: null,
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

// #1109: any HTTP answer used to count as "up", so Tempo and Loki still answering 503 on /ready
// while they start made `env:doctor` report the whole stack as up.
describe('isObservabilityProbeHealthy', () => {
  const READINESS_PROBES: Probe[] = ['grafana', 'tempo', 'loki', 'prometheus'];

  it.each(READINESS_PROBES)('%s is healthy on any 2xx or 3xx', (probe) => {
    for (const code of [200, 204, 301, 302, 399]) {
      expect(doctor.isObservabilityProbeHealthy(probe, code), `${probe} ${code}`).toBe(true);
    }
  });

  it.each(READINESS_PROBES)('%s is not healthy on a 4xx, a 5xx or no answer', (probe) => {
    // 404 included: a readiness endpoint that is not found is not a ready service.
    for (const code of [0, 100, 199, 400, 401, 404, 500, 503]) {
      expect(doctor.isObservabilityProbeHealthy(probe, code), `${probe} ${code}`).toBe(false);
    }
  });

  it('accepts a 404 from the OTLP collector, which has no handler on /', () => {
    expect(doctor.isObservabilityProbeHealthy('otlp', 404)).toBe(true);
    for (const code of [200, 204, 301]) {
      expect(doctor.isObservabilityProbeHealthy('otlp', code), `otlp ${code}`).toBe(true);
    }
  });

  it('still rejects an OTLP collector that does not answer or fails', () => {
    for (const code of [0, 400, 403, 500, 503]) {
      expect(doctor.isObservabilityProbeHealthy('otlp', code), `otlp ${code}`).toBe(false);
    }
  });
});

describe('observabilityHealth', () => {
  it('is not up while Tempo and Loki still answer 503 (the case in #1109)', () => {
    const health = doctor.observabilityHealth({
      grafana: 200,
      tempo: 503,
      loki: 503,
      prometheus: 200,
      otlp: 404,
    });

    expect(health).toEqual({ healthy: 3, answering: 5, up: false });
    expect(doctor.observabilityLabel(health.healthy, 5)).toBe('partial (3/5)');
  });

  it('is up when every service is ready, the collector answering its 404', () => {
    const health = doctor.observabilityHealth({
      grafana: 200,
      tempo: 200,
      loki: 200,
      prometheus: 200,
      otlp: 404,
    });

    expect(health).toEqual({ healthy: 5, answering: 5, up: true });
    expect(doctor.observabilityLabel(health.healthy, 5)).toBe('up');
  });

  it('is down when nothing answers', () => {
    const health = doctor.observabilityHealth({
      grafana: 0,
      tempo: 0,
      loki: 0,
      prometheus: 0,
      otlp: 0,
    });

    expect(health).toEqual({ healthy: 0, answering: 0, up: false });
    expect(doctor.observabilityLabel(health.healthy, 5)).toBe('down');
  });

  it('is down yet still answering when every service returns 503, so the ports stay reported as held', () => {
    const health = doctor.observabilityHealth({
      grafana: 503,
      tempo: 503,
      loki: 503,
      prometheus: 503,
      otlp: 503,
    });

    expect(health).toEqual({ healthy: 0, answering: 5, up: false });
    expect(doctor.observabilityLabel(health.healthy, 5)).toBe('down');
  });

  it('does not count an OTLP 404 as up when the rest of the stack is down', () => {
    const health = doctor.observabilityHealth({
      grafana: 0,
      tempo: 0,
      loki: 0,
      prometheus: 0,
      otlp: 404,
    });

    expect(health.up).toBe(false);
    expect(doctor.observabilityLabel(health.healthy, 5)).toBe('partial (1/5)');
  });
});

const READY_OPTIONS = { primary: '/workspaces/studiq', primaryReady: true, authOk: true };

const LEGACY_STACK_NOTE =
  'a partial/legacy stack is holding a port; identify it with `docker compose ls` and stop that project from its own directory';

// The report's decision used to live in the call site, so only the probes were pinned: reverting
// `up` to "any answer" or the label to the answering count left every test green (#1109 review).
describe('observabilitySummary', () => {
  it('says up only when every service serves', () => {
    const summary = doctor.observabilitySummary(
      { grafana: 200, tempo: 200, loki: 200, prometheus: 200, otlp: 404 },
      READY_OPTIONS,
    );

    expect(summary).toEqual({ up: true, label: 'up', notes: [] });
  });

  it('keeps the 3/5 boot window free of the legacy-stack note', () => {
    const summary = doctor.observabilitySummary(
      { grafana: 200, tempo: 503, loki: 503, prometheus: 200, otlp: 404 },
      READY_OPTIONS,
    );

    expect(summary).toEqual({
      up: false,
      label: 'partial (3/5)',
      notes: [
        'start it once from the primary checkout, never from a worktree',
        'traces/logs are not readable by agents; do not substitute a local trace id',
      ],
    });
  });

  it('names a legacy stack only when it answers but serves nothing', () => {
    const summary = doctor.observabilitySummary(
      { grafana: 503, tempo: 503, loki: 503, prometheus: 503, otlp: 503 },
      READY_OPTIONS,
    );

    expect(summary.up).toBe(false);
    expect(summary.label).toBe('down');
    expect(summary.notes).toContain(LEGACY_STACK_NOTE);
  });

  it('does not name a legacy stack when nothing answers', () => {
    const summary = doctor.observabilitySummary(
      { grafana: 0, tempo: 0, loki: 0, prometheus: 0, otlp: 0 },
      READY_OPTIONS,
    );

    expect(summary.notes).not.toContain(LEGACY_STACK_NOTE);
  });
});

describe('docker-compose host ports', () => {
  it('publishes exactly the host → container pairs in OBSERVABILITY_PORTS on loopback', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');
    const published = compose
      .split('\n')
      .map((line) => /^\s*-\s*'([^']+)'\s*(?:#.*)?$/.exec(line)?.[1] ?? null)
      .filter((value): value is string => value !== null)
      .filter((value) => /^(?:[^:]+:)?\d+:\d+$/.test(value))
      .map((value) => {
        const parts = value.split(':');
        return {
          host: parts.length === 3 ? parts[0] : null,
          hostPort: Number(parts[parts.length - 2]),
          containerPort: Number(parts[parts.length - 1]),
        };
      })
      .toSorted((a, b) => a.hostPort - b.hostPort);
    const expected = OBSERVABILITY_PORT_KEYS.map(
      (service) => [observability.OBSERVABILITY_PORTS[service], CONTAINER_PORTS[service]] as const,
    ).toSorted(([a], [b]) => a - b);

    // The stack is admin-capable: publishing it beyond loopback is a real exposure.
    expect(published.every((entry) => entry.host === '127.0.0.1')).toBe(true);
    expect(published.map((entry) => [entry.hostPort, entry.containerPort] as const)).toEqual(
      expected,
    );
  });
});

describe('applyStackEnv observability defaults', () => {
  it('points the app at the machine-wide collector and names the checkout', () => {
    lifecycle.applyStackEnv(stackEnv, {
      appUrl: 'http://localhost:3000',
      appEnv: 'test',
      stackId: 'stack-123',
    });

    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:7318');
    expect(process.env.OTEL_SERVICE_NAME).toMatch(/^studiq-[a-z0-9-]+$/);
  });

  it('preserves an explicit service name and endpoint from .env.local', () => {
    process.env.OTEL_SERVICE_NAME = 'custom-service';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel.example:7318';

    lifecycle.applyStackEnv(stackEnv, { appUrl: 'http://localhost:3000', appEnv: 'test' });

    expect(process.env.OTEL_SERVICE_NAME).toBe('custom-service');
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://otel.example:7318');
  });
});
