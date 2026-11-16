import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { asJson } from '#test/helpers/json';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  parseJsonObject,
  stackStatusFixture,
  startHttpServer,
  stoppedStackFixture,
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

/** A ready checkout: one HTTP server answers as both the app and Supabase REST. */
async function readyEnv(
  harness: Harness,
): Promise<{ server: Awaited<ReturnType<typeof startHttpServer>>; env: NodeJS.ProcessEnv }> {
  const server = await startHttpServer(200);
  harness.track(() => server.close());
  harness.setStatusFixture(
    stackStatusFixture({
      apiUrl: server.url,
      apiPort: server.port,
      mailUrl: 'http://127.0.0.1:20503',
    }),
  );
  return {
    server,
    env: { APP_PORT: String(server.port), APP_URL: server.url },
  };
}

function pointerPath(harness: Harness): string {
  return String(harness.env.STUDIQ_QA_POINTER);
}

describe('env:share', () => {
  it('prints the URL-only pointer and never a key', async () => {
    const harness = newHarness();
    const { server, env } = await readyEnv(harness);

    const result = await harness.run(['share', '--json'], env);

    expect(result.status).toBe(0);
    const pointer = parseJsonObject(result.stdout);
    expect(pointer.appUrl).toBe(server.url);
    // The status contract normalises a loopback API URL to `localhost`; the port
    // is what identifies the stack.
    expect(new URL(String(pointer.supabaseUrl)).port).toBe(String(server.port));
    expect(new URL(String(pointer.mailpitUrl)).port).toBe('20503');
    expect(typeof pointer.stackId).toBe('string');
    expect(typeof pointer.writtenAt).toBe('string');
    // The stack fixture carries sentinel keys; the pointer must not repeat one.
    expect(result.stdout).not.toMatch(/sentinel|ANON_KEY|SERVICE_ROLE_KEY|SECRET_KEY/);
  });

  it('--write creates the pointer private to this user, and is idempotent', async () => {
    const harness = newHarness();
    const { server, env } = await readyEnv(harness);

    const first = await harness.run(['share', '--write'], env);
    expect(first.status).toBe(0);

    const path = pointerPath(harness);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const written = asJson<{ appUrl: string }>(JSON.parse(readFileSync(path, 'utf8')));
    expect(written.appUrl).toBe(server.url);

    const second = await harness.run(['share', '--write'], env);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('(unchanged)');
  });

  it('refuses when the environment is not answering', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());

    const result = await harness.run(['share', '--write']);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('nothing to share');
  });

  it('refuses in shared mode: a consumer owns no stack to share', async () => {
    const harness = newHarness();
    const { server, env } = await readyEnv(harness);

    const result = await harness.run(['share', '--json'], {
      ...env,
      SUPABASE_SHARED: '1',
      SUPABASE_URL: server.url,
    });

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('owns no stack to share');
  });

  it('refuses to retarget an existing pointer without --force', async () => {
    const harness = newHarness();
    const { env } = await readyEnv(harness);
    const path = pointerPath(harness);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ appUrl: 'http://127.0.0.1:9', supabaseUrl: 'http://127.0.0.1:9' }),
    );

    const refused = await harness.run(['share', '--write'], env);
    expect(refused.status).toBe(6);
    expect(refused.stderr).toContain('--force');

    const forced = await harness.run(['share', '--write', '--force'], env);
    expect(forced.status).toBe(0);
    const written = asJson<{ appUrl: string }>(JSON.parse(readFileSync(path, 'utf8')));
    expect(written.appUrl).not.toBe('http://127.0.0.1:9');
  });

  it('rejects --force without --write', async () => {
    const harness = newHarness();

    const result = await harness.run(['share', '--force']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("'--force' only applies with '--write'");
  });
});
