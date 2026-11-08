import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  firstFreePort,
  nonLoopbackIPv4,
  parseJsonObject,
  startTcpListener,
  type Harness,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];

// CI-safe: the other-interface case is skipped when the host has no
// non-loopback IPv4 address.
const NON_LOOPBACK = nonLoopbackIPv4();

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
    // `suggestFreeAppPort` bind-checks the wildcard address, so the oracle must too.
    const listener = await startTcpListener(port, '0.0.0.0').catch(() => null);
    if (!listener) continue;
    await listener.close();
    return port;
  }
  throw new Error(`no free port found from ${from}`);
}

/** A port free both on `address` and on loopback. */
async function findConflictPort(address: string): Promise<number> {
  for (let port = 3000; port <= 3999; port += 1) {
    if (port === 3010) continue;
    const onAddress = await startTcpListener(port, address).catch(() => null);
    if (!onAddress) continue;
    await onAddress.close();
    const onLoopback = await startTcpListener(port, '127.0.0.1').catch(() => null);
    if (!onLoopback) continue;
    await onLoopback.close();
    return port;
  }
  throw new Error('no port free on both the non-loopback address and loopback');
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

  it.skipIf(!NON_LOOPBACK)('skips a port bound on a non-loopback interface', async () => {
    if (!NON_LOOPBACK) throw new Error('no non-loopback IPv4 address');
    const port = await findConflictPort(NON_LOOPBACK);
    const harness = newHarness();
    const listener = await startTcpListener(port, NON_LOOPBACK);
    harness.track(() => listener.close());

    // Loopback is still bindable: this is a real other-interface conflict, not
    // a loopback listener the connect probe would already have seen.
    const loopback = await startTcpListener(port, '127.0.0.1');
    await loopback.close();

    const expected = await nextFreePort(3000, new Set([port]));
    const result = await harness.run(['ports', '--json']);

    expect(result.status).toBe(0);
    const ports = parseJsonObject(result.stdout);
    expect(ports.appPort).toBe(expected);
    expect(ports.appPort).not.toBe(port);
  });

  it('refuses to suggest when the registry exists but is untrusted (exit 6)', async () => {
    const harness = newHarness();
    mkdirSync(join(harness.dir, 'real-registry'), { recursive: true });
    symlinkSync(join(harness.dir, 'real-registry'), harness.registryDir);

    const result = await harness.run(['ports', '--json']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('not a trusted private directory');
  });

  it('prints a shell-friendly suggestion without --json', async () => {
    const harness = newHarness();
    const result = await harness.run(['ports']);
    expect(result.status).toBe(0);

    const match = /^APP_PORT=(\d+)$/m.exec(result.stdout);
    expect(match).not.toBeNull();
    const appPort = Number(match?.[1]);
    expect(Number.isInteger(appPort)).toBe(true);
    expect(appPort).toBeGreaterThanOrEqual(3000);
    expect(appPort).toBeLessThanOrEqual(3999);
    expect(appPort).not.toBe(3010);
  });

  it('rejects unknown flags with exit code 2', async () => {
    const harness = newHarness();
    const result = await harness.run(['ports', '--block', '2']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--block'");
  });
});
