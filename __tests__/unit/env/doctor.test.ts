import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  findConflictPort,
  firstFreePort,
  nonLoopbackIPv4,
  parseJsonObject,
  stackStatusFixture,
  startHttpServer,
  startTcpListener,
  stoppedStackFixture,
  stringList,
  type Harness,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];

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

describe('env:doctor', () => {
  it('exits 0 when nothing is wrong (no stack for this branch)', async () => {
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    // A stopped stack answers `stack status` cleanly (exit 0, no API URL).
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(Array.isArray(report.warnings)).toBe(true);
    // A stopped/absent stack is a clean CLI answer, not a CLI failure.
    expect(stringList(report.warnings).join('\n')).not.toContain('supabase stack status');
  });

  it('does not warn about a missing registry directory', async () => {
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    // A missing registry is normal: no warning at all here.
    expect(stringList(report.warnings)).toHaveLength(0);
  });

  it('warns when an existing registry directory is untrusted', async () => {
    const appPort = await firstFreePort(3900);
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
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    // No fixture: the fake CLI exits non-zero (a failed lookup, not a stopped stack).
    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.warnings).join('\n')).toContain("cannot read 'supabase stack status'");
  });

  it('warns when stack status returns non-JSON output', async () => {
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    harness.setRawStatus('Warning: banner\nnot-json');

    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(stringList(report.warnings)).toHaveLength(1);
  });

  it('warns when the Supabase CLI cannot be spawned', async () => {
    const appPort = await firstFreePort(3900);
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
    const port = await findConflictPort(NON_LOOPBACK);
    const harness = newHarness();
    const listener = await startTcpListener(port, NON_LOOPBACK);
    harness.track(() => listener.close());

    const result = await harness.run(['doctor', '--json'], { APP_PORT: String(port) });

    expect(result.status).toBe(1);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(false);
    expect(stringList(report.problems)).toHaveLength(1);
  });

  it('reports the stack runtime it observes and warns about a Docker stack', async () => {
    const server = await startHttpServer(200);
    const appPort = await firstFreePort(3900);
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
    const appPort = await firstFreePort(3900);
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
    const appPort = await firstFreePort(3900);
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
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    const result = await harness.run(['doctor'], { APP_PORT: String(appPort) });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('▸ Checkout');
    expect(result.stdout).toContain('▸ Local stack');
    expect(result.stdout).toContain('▸ Runtime');
    expect(result.stdout).toContain('unknown (not observable here)');
    expect(result.stdout).toContain('No ownership or port conflicts');
  });

  it('rejects unknown flags with exit code 2', async () => {
    const harness = newHarness();
    const result = await harness.run(['doctor', '--fix']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--fix'");
  });
});
