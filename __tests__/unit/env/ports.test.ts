import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  firstFreePort,
  parseJsonObject,
  startTcpListener,
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

/** Independent restatement of the documented suggestion rule. */
async function nextFreePort(from: number, skip: ReadonlySet<number>): Promise<number> {
  for (let port = from; port <= 3999; port += 1) {
    if (port === 3010 || skip.has(port)) continue;
    const listener = await startTcpListener(port).catch(() => null);
    if (!listener) continue;
    await listener.close();
    return port;
  }
  throw new Error(`no free port found from ${from}`);
}

describe('env:ports --json', () => {
  it('reports the phase-1 contract and skips a registry-claimed port', async () => {
    const claimed = await firstFreePort(3000, new Set([3010]));
    const harness = newHarness();
    harness.writeRegistryEntry({
      projectId: 'studiq-fixture-claimed-port',
      worktree: '/tmp/another-checkout',
      appPort: claimed,
      mode: 'dev',
    });

    const expected = await nextFreePort(3000, new Set([claimed]));
    const result = await harness.run(['ports', '--json']);

    expect(result.status).toBe(0);
    const ports = parseJsonObject(result.stdout);
    expect(ports).toEqual({ appPort: expected, block: null, stackPorts: 'dynamic' });
    expect(ports.appPort).not.toBe(claimed);
    expect(result.stdout).not.toContain('/tmp/another-checkout');
  });

  it('prints a shell-friendly suggestion without --json', async () => {
    const harness = newHarness();
    const result = await harness.run(['ports']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^APP_PORT=\d+$/m);
    expect(result.stdout).toContain('Supabase stack ports are assigned');
  });

  it('rejects unknown flags with exit code 2', async () => {
    const harness = newHarness();
    const result = await harness.run(['ports', '--block', '2']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--block'");
  });
});
