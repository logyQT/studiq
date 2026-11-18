import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appPortBase,
  createHarness,
  findConflictPort,
  firstBindablePort,
  nonLoopbackIPv4,
  objectField,
  parseJsonObject,
  stackStatusFixture,
  startGrafanaServer,
  startHttpServer,
  startTcpListener,
  stoppedStackFixture,
  stringList,
  type Harness,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];

/**
 * Doctor bind-checks a live `APP_PORT`, so this file must own a port that no
 * other [parallel] unit file can bind. The shared 3000-3999 range is exactly
 * where the other env files used to collide, and a host may permanently hold
 * one of those ports (a docker proxy, say), hence a per-file base outside it
 * and below the ephemeral range.
 */
const APP_PORT_BASE = appPortBase();

// CI-safe: the other-interface case is skipped when the host has none.
const NON_LOOPBACK = nonLoopbackIPv4();

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/**
 * A `.next/cache` fixture under this harness, independent of the checkout.
 *
 * `entries` are written beside a real `turbopack/` so the layout is the one a
 * build leaves behind; `env:dev` writes Next's telemetry batch as well, and that
 * is the entry these fixtures exist to reproduce.
 */
function writeCacheFixture(harness: Harness, entries: readonly string[]): string {
  const cacheDir = join(harness.dir, 'apps', 'web', '.next', 'cache');
  mkdirSync(join(cacheDir, 'turbopack', 'v16.4.5-4e5335a0'), { recursive: true });
  for (const name of entries) writeFileSync(join(cacheDir, name), '');
  return cacheDir;
}

/** The errno code of a wildcard bind attempt, or null when it succeeds. */
function bindErrorCode(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error) => {
      resolve('code' in error && typeof error.code === 'string' ? error.code : 'unknown');
    });
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(null)));
  });
}

describe('env:doctor', () => {
  it('exits 0 when nothing is wrong (no stack for this branch)', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    // A stopped stack answers `stack status` cleanly (exit 0, no API URL).
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    // A stopped/absent stack is a clean CLI answer, not a CLI failure.
    expect(stringList(report.warnings).join('\n')).not.toContain('supabase stack status');
  });

  it('warns when the QA pointer sends specs to another app', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const pointer = String(harness.env.STUDIQ_QA_POINTER);
    mkdirSync(dirname(pointer), { recursive: true });
    writeFileSync(
      pointer,
      JSON.stringify({
        appUrl: 'http://localhost:3999',
        supabaseUrl: 'http://localhost:3998',
        stackId: 'stack-that-is-not-on-this-machine',
      }),
    );

    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const warnings = stringList(parseJsonObject(result.stdout).warnings).join('\n');
    expect(warnings).toContain('points at http://localhost:3999');
    expect(warnings).toContain('not in this machine');
  });

  it('reports the machine-wide observability stack and its primary start command', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report).toHaveProperty('observability.project', 'studiq-observability');
    expect(report).toHaveProperty('observability.primary');
    expect(report).toHaveProperty('observability.primaryReady');
    expect(report).toHaveProperty('observability.up');
    expect(JSON.stringify(report.observability)).toContain('docker compose up -d');
  });

  it('reports Grafana auth ok when the MCP token validates', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const fixture = await startGrafanaServer({ token: 'glsa_valid' });
    harness.track(() => fixture.close());
    const dir = join(harness.dir, '.config', 'studiq', 'observability');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'grafana-mcp-token'), 'glsa_valid\n', { mode: 0o600 });
    writeFileSync(
      join(dir, 'grafana-mcp.json'),
      JSON.stringify({
        serviceAccountId: 1,
        serviceAccountName: 'studiq-mcp',
        role: 'Viewer',
        tokenId: 7,
        tokenName: 'mcp-test',
        mintedAt: new Date().toISOString(),
        url: fixture.url,
      }),
      { mode: 0o600 },
    );

    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      GRAFANA_URL: fixture.url,
    });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report).toHaveProperty('observability.auth', 'ok');
    expect(report).toHaveProperty('observability.serviceAccount', 'studiq-mcp');
    expect(report).toHaveProperty('observability.tokenFile', join(dir, 'grafana-mcp-token'));
  });

  it('reports a missing Grafana MCP token without failing doctor', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const fixture = await startGrafanaServer();
    harness.track(() => fixture.close());

    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      GRAFANA_URL: fixture.url,
    });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report).toHaveProperty('observability.auth', 'no-token');
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);

    // The remediation must name the command that mints: `status` (the default
    // mode) prints the same line but never creates a token.
    const text = await harness.run(['doctor'], {
      APP_PORT: String(appPort),
      GRAFANA_URL: fixture.url,
    });
    expect(text.stdout).toContain('bun run env:observability ensure');
  });

  it('reports a stale token when the token file cannot be read', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const fixture = await startGrafanaServer({ token: 'glsa_valid' });
    harness.track(() => fixture.close());
    const dir = join(harness.dir, '.config', 'studiq', 'observability');
    // A directory at the token path reproduces EISDIR deterministically; chmod
    // 000 is not reliable under root, where CI may run.
    mkdirSync(join(dir, 'grafana-mcp-token'), { recursive: true });
    writeFileSync(
      join(dir, 'grafana-mcp.json'),
      JSON.stringify({
        serviceAccountId: 1,
        serviceAccountName: 'studiq-mcp',
        role: 'Viewer',
        tokenId: 7,
        tokenName: 'mcp-test',
        mintedAt: new Date().toISOString(),
        url: fixture.url,
      }),
      { mode: 0o600 },
    );

    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      GRAFANA_URL: fixture.url,
    });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report).toHaveProperty('observability.auth', 'stale-token');
  });

  it('does not warn about a missing registry directory', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    // A missing registry is normal: no warning at all here.
    expect(stringList(report.warnings)).toHaveLength(0);
  });

  it('reports a dev-server telemetry batch as a known exclusion, not an unknown entry', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const batch = '_events_4242_0487b99c35c29ae3.json';
    writeCacheFixture(harness, ['config.json', batch]);

    const json = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });
    expect(json.status).toBe(0);
    const report = parseJsonObject(json.stdout);
    expect(stringList(report.problems)).toEqual([]);
    // An extra file in `.next/cache` is not a warning when it is a known
    // exclusion; only an unrecognised entry is.
    expect(stringList(report.warnings)).toEqual([]);
    expect(objectField(report, 'cache')).toHaveProperty('layoutRecognised', true);
    expect(stringList(objectField(report, 'cache').layout)).toContain(batch);

    const text = await harness.run(['doctor'], { APP_PORT: String(appPort) });
    expect(text.status).toBe(0);
    const layoutLine = text.stdout.split('\n').find((line) => line.includes('  layout')) ?? '';
    // The file is reported, not hidden, and named as excluded from snapshots.
    expect(layoutLine).toContain(batch);
    expect(layoutLine).toContain('recognised');
    expect(layoutLine).toContain('not snapshotted:');
  });

  it('names the cache directory it read, not a hard-coded path', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const cacheDir = join(harness.dir, 'apps', 'web', '.next', 'cache');

    const missing = await harness.run(['doctor'], { APP_PORT: String(appPort) });
    expect(missing.status).toBe(0);
    expect(missing.stdout).toContain(`none (${cacheDir} does not exist)`);

    writeCacheFixture(harness, ['surprise']);
    const unknown = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });
    const warnings = stringList(parseJsonObject(unknown.stdout).warnings).join('\n');
    // The warning names the directory that was classified, not `apps/web/.next/cache`.
    expect(warnings).toContain(`${cacheDir} layout is unrecognised`);
  });

  it('warns when an existing registry directory is untrusted', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    mkdirSync(join(harness.dir, 'real-registry'), { recursive: true });
    symlinkSync(join(harness.dir, 'real-registry'), harness.registryDir);

    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    // Exactly the untrusted-registry warning; a missing one stays silent.
    expect(stringList(report.warnings)).toHaveLength(1);
  });

  it('warns when the stack status lookup fails but stays exit 0', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    // No fixture: the fake CLI exits non-zero (a failed lookup, not a stopped stack).
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.warnings).join('\n')).toContain("cannot read 'supabase stack status'");
  });

  it('warns when stack status returns non-JSON output', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setRawStatus('Warning: banner\nnot-json');

    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.warnings)).toHaveLength(1);
  });

  it('checks the default stack when SUPABASE_STACK is unset', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      SUPABASE_STACK: '',
    });

    expect(result.status).toBe(0);
    expect(harness.bunxCalls()).toContain('stack status --output-format json');
    expect(harness.bunxCalls()).not.toContain('--stack');
  });

  it('warns when the Supabase CLI cannot be spawned', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    // No `bunx` on PATH: status/list spawn with ENOENT.
    const result = await harness.run(['doctor', '--json'], {
      PATH: harness.dir,
      APP_PORT: String(appPort),
    });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.warnings).join('\n')).toContain("cannot read 'supabase stack status'");
  });

  it('exits 1 when the app port is occupied by another process', async () => {
    const listener = await startTcpListener(0);
    const harness = newHarness();
    harness.track(() => listener.close());

    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(listener.port),
    });

    expect(result.status).toBe(1);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(false);
    expect(stringList(report.problems).join('\n')).toContain(`app port ${listener.port} is in use`);
  });

  it.skipIf(!NON_LOOPBACK)('flags an app port bound on a non-loopback interface', async () => {
    if (!NON_LOOPBACK) throw new Error('no non-loopback IPv4 address');
    // Any app port works here: the conflict is on a non-loopback interface, not
    // in the product's suggestion range, so this file's own slice is used.
    const port = await findConflictPort(NON_LOOPBACK, APP_PORT_BASE, APP_PORT_BASE + 19);
    const harness = newHarness();
    const listener = await startTcpListener(port, NON_LOOPBACK);
    harness.track(() => listener.close());

    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(port) });

    expect(result.status).toBe(1);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(false);
    expect(stringList(report.problems)).toHaveLength(1);
  });

  it('treats a non-EADDRINUSE bind error as a warning, not a conflict', async (context) => {
    // Port 80 only reproduces EACCES when this process lacks the privilege to
    // bind it; skip when the environment allows (free) or another listener holds it.
    const code = await bindErrorCode(80);
    if (code !== 'EACCES') {
      context.skip();
      return;
    }

    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], { APP_PORT: '80' });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.problems)).toHaveLength(0);
    expect(stringList(report.warnings)).toHaveLength(1);
  });

  it('reports the stack runtime it observes and warns about a Docker stack', async () => {
    const server = await startHttpServer(200);
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.track(() => server.close());
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: server.url, apiPort: server.port, runtime: 'docker' }),
    );

    const json = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      APP_URL: `http://localhost:${appPort}`,
      // Must be ignored: read-only commands never select a runtime.
      SUPABASE_RUNTIME: 'native',
    });
    expect(json.status).toBe(0);
    const report = parseJsonObject(json.stdout);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(stringList(report.warnings).join('\n')).toContain('runtime=docker (compatibility mode)');

    const human = await harness.run(['doctor'], {
      APP_PORT: String(appPort),
      APP_URL: `http://localhost:${appPort}`,
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('observed   docker');
    expect(human.stdout).toContain('source     running stack');
    // A running stack already carries its runtime: no `stack list` lookup.
    expect(harness.bunxCalls()).not.toContain('stack list');
  });

  it('never probes docker/podman and ignores SUPABASE_RUNTIME', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();

    for (const runtime of ['', 'auto', 'docker', 'native', 'podman']) {
      const status = await harness.run(['status', '--json'], {
        APP_PORT: String(appPort),
        SUPABASE_RUNTIME: runtime,
      });
      expect(status.status).toBe(0);
      expect(parseJsonObject(status.stdout).runtime).toBeNull();

      const doctor = await harness.run(['doctor', '--json'], {
        APP_PORT: String(appPort),
        SUPABASE_RUNTIME: runtime,
      });
      expect(doctor.status).toBe(0);
      expect(parseJsonObject(doctor.stdout).problems).toEqual([]);
    }

    expect(harness.engineCalls()).toBe('');
  });

  it('warns but does not fail when shared-mode values are not exported', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      SUPABASE_SHARED: '1',
    });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.warnings).join('\n')).toContain('SUPABASE_SHARED=1');
  });

  it('renders human sections on stdout', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    const result = await harness.run(['doctor'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('▸ Checkout');
    expect(result.stdout).toContain('▸ Local stack');
    expect(result.stdout).toContain('▸ Runtime');
    expect(result.stdout).toContain('unknown (not observable here)');
    expect(result.stdout).toContain('No ownership or port conflicts');
  });

  it('reports build slots and warns about a stale one', async () => {
    const appPort = await firstBindablePort(APP_PORT_BASE);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const slots = join(harness.registryDir, 'build-slots');
    mkdirSync(join(slots, '2'), { recursive: true });
    writeFileSync(join(slots, '2', 'pid'), '999999999\n');
    writeFileSync(join(slots, 'capacity'), '2\n');

    const json = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });
    expect(json.status).toBe(0);
    const warnings = stringList(parseJsonObject(json.stdout).warnings).join('\n');
    expect(warnings).toContain('1 stale build slot(s)');

    const text = await harness.run(['doctor'], { APP_PORT: String(appPort) });
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('▸ Build slots');
    expect(text.stdout).toContain('0 of 2 busy, 1 stale');
    expect(text.stdout).toContain('cap        2 (recorded when derived');
  });

  it('rejects unknown flags with exit code 2', async () => {
    const harness = newHarness();
    const result = await harness.run(['doctor', '--fix']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--fix'");
  });
});
