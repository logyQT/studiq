import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  firstFreePort,
  parseJsonObject,
  startTcpListener,
  stringList,
  type Harness,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];

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
    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      SUPABASE_RUNTIME: 'native',
    });

    expect(result.status).toBe(0);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(Array.isArray(report.warnings)).toBe(true);
  });

  it('exits 1 when the app port is occupied by another process', async () => {
    const listener = await startTcpListener(0);
    const harness = newHarness();
    harness.track(() => listener.close());

    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(listener.port),
      SUPABASE_RUNTIME: 'native',
    });

    expect(result.status).toBe(1);
    const report = parseJsonObject(result.stdout);
    expect(report.ok).toBe(false);
    expect(stringList(report.problems).join('\n')).toContain(`app port ${listener.port} is in use`);
  });

  it('exits 1 when the effective runtime is unavailable', async () => {
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    // A PATH without tar/docker makes the platform hint fail deterministically.
    const result = await harness.run(['doctor', '--json'], {
      PATH: `${harness.dir}/bin`,
      APP_PORT: String(appPort),
      SUPABASE_RUNTIME: 'native',
    });

    expect(result.status).toBe(1);
    const report = parseJsonObject(result.stdout);
    expect(stringList(report.problems).join('\n')).toContain("runtime 'native' is unavailable");
  });

  it('warns but does not fail when shared-mode values are not exported', async () => {
    const appPort = await firstFreePort(3900);
    const harness = newHarness();
    const result = await harness.run(['doctor', '--json'], {
      APP_PORT: String(appPort),
      SUPABASE_RUNTIME: 'native',
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
    const result = await harness.run(['doctor'], {
      APP_PORT: String(appPort),
      SUPABASE_RUNTIME: 'native',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('▸ Checkout');
    expect(result.stdout).toContain('▸ Local stack');
    expect(result.stdout).toContain('▸ Runtime');
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
