import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, objectField, parseJsonObject, type Harness } from '#test/unit/env/support';

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/**
 * `status --json` is the cheapest read of the contract: no stack fixture, so
 * both probes fail fast and the JSON still exposes `ports.app` / `urls.app`.
 */
function readStatus(env: NodeJS.ProcessEnv): ReturnType<Harness['run']> {
  return newHarness().run(['status', '--json'], env);
}

function appPort(stdout: string): unknown {
  return objectField(parseJsonObject(stdout), 'ports').app;
}

function appUrl(stdout: string): unknown {
  return objectField(parseJsonObject(stdout), 'urls').app;
}

describe('env contract: APP_PORT vs loopback APP_URL', () => {
  it('rejects an APP_PORT that disagrees with a loopback APP_URL', async () => {
    const result = await readStatus({ APP_PORT: '3011', APP_URL: 'http://localhost:3000' });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'APP_PORT=3011 does not match loopback APP_URL http://localhost:3000 (port 3000)',
    );
  });

  it('accepts matching loopback ports', async () => {
    const result = await readStatus({ APP_PORT: '3011', APP_URL: 'http://localhost:3011' });

    expect(result.status).toBe(0);
    expect(appPort(result.stdout)).toBe(3011);
    expect(appUrl(result.stdout)).toBe('http://localhost:3011');
  });

  it('rejects APP_PORT when a loopback URL omits its port (scheme default applies)', async () => {
    const result = await readStatus({ APP_PORT: '3011', APP_URL: 'http://127.0.0.1' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'APP_PORT=3011 does not match loopback APP_URL http://127.0.0.1 (port 80)',
    );
  });

  it('treats [::1] as loopback too', async () => {
    const result = await readStatus({ APP_PORT: '3011', APP_URL: 'http://[::1]:443' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('(port 443)');
  });

  it('leaves a non-loopback (proxied) APP_URL alone', async () => {
    const result = await readStatus({
      APP_PORT: '3011',
      APP_URL: 'https://app.example.com',
    });

    expect(result.status).toBe(0);
    expect(appPort(result.stdout)).toBe(3011);
    expect(appUrl(result.stdout)).toBe('https://app.example.com');
  });

  it('derives the port from APP_URL when APP_PORT is unset', async () => {
    const result = await readStatus({ APP_URL: 'http://127.0.0.1:3088' });

    expect(result.status).toBe(0);
    expect(appPort(result.stdout)).toBe(3088);
    expect(appUrl(result.stdout)).toBe('http://127.0.0.1:3088');
  });

  it('derives the scheme default for a loopback URL without a port', async () => {
    const result = await readStatus({ APP_URL: 'https://localhost' });

    expect(result.status).toBe(0);
    expect(appPort(result.stdout)).toBe(443);
    expect(appUrl(result.stdout)).toBe('https://localhost');
  });
});
