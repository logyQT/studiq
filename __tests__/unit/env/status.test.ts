import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  objectField,
  parseJsonObject,
  stackStatusFixture,
  startHttpServer,
  stoppedStackFixture,
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

describe('env:status --json', () => {
  it('reports a stopped checkout without crashing and without secrets', async () => {
    const harness = newHarness();
    // A stopped stack still answers `stack status` cleanly (exit 0, no API URL).
    harness.setStatusFixture(stoppedStackFixture());
    // SUPABASE_RUNTIME is not an input to a read-only command.
    const result = await harness.run(['status', '--json'], { SUPABASE_RUNTIME: 'docker' });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    const ports = objectField(status, 'ports');
    const urls = objectField(status, 'urls');
    const supabase = objectField(status, 'supabase');

    expect(status.ready).toBe(false);
    expect(status.stack).toBeNull();
    expect(status.stackId).toBeNull();
    expect(status.runtime).toBeNull();
    expect(status.branch).toBeNull();
    expect(status.projectId).toBeNull();
    expect(status.mode).toBeNull();
    expect(status.owner).toBeNull();
    expect(supabase).toEqual({ url: null, http: 0 });
    expect(urls.supabase).toBeNull();
    expect(urls.db).toBeNull();
    expect(urls.mail).toBeNull();
    expect(urls.studio).toBeNull();
    expect(status.dbUrl).toBeNull();
    expect(status.mailUrl).toBeNull();
    expect(ports.api).toBe(0);
    expect(ports.db).toBe(0);
    expect(ports.studio).toBe(0);
    expect(ports.mail).toBe(0);
    expect(ports.mailSmtp).toBe(0);
    expect(ports.mailPop3).toBe(0);
    expect(ports.pgmeta).toBe(0);
    expect(ports.block).toBeNull();
    expect(status.profile).toBeNull();
    expect(status.cold).toBeNull();
    expect(status.seeded).toBeNull();
    expect(status.warnings).toEqual([]);
    expect(status.log).toBe('.dev/env.log');
    expect(status.registry).toBe(harness.env.STUDIQ_DEV_REGISTRY);
    expect('warmMs' in status).toBe(false);
    expect(result.stdout).not.toMatch(/ANON_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|SECRET_KEY/);
  });

  it('warns when the stack status lookup itself fails', async () => {
    const harness = newHarness();
    // No fixture: the fake CLI exits non-zero (a failed lookup, not a stopped stack).
    const result = await harness.run(['status', '--json']);

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    expect(status.ready).toBe(false);
    expect(status.stack).toBeNull();
    expect(stringList(status.warnings).join('\n')).toContain("cannot read 'supabase stack status'");
  });

  it('warns when the registry exists but is untrusted', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    mkdirSync(join(harness.dir, 'real-registry'), { recursive: true });
    symlinkSync(join(harness.dir, 'real-registry'), harness.registryDir);

    const result = await harness.run(['status', '--json']);

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    expect(stringList(status.warnings)).toHaveLength(1);
  });

  it('strips query and fragment credentials from the database URL', async () => {
    const server = await startHttpServer(200);
    const harness = newHarness();
    harness.track(() => server.close());
    harness.setStatusFixture(
      stackStatusFixture({
        apiUrl: server.url,
        apiPort: server.port,
        dbUrl:
          'postgresql://postgres:user-password@127.0.0.1:30040/postgres' +
          '?password=query-secret&sslpassword=qsecret#frag-secret',
      }),
    );

    const result = await harness.run(['status', '--json'], {
      APP_PORT: String(server.port),
      APP_URL: server.url,
    });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    expect(status.dbUrl).toBe('postgresql://localhost:30040/postgres');
    expect(result.stdout).not.toContain('user-password');
    expect(result.stdout).not.toContain('query-secret');
    expect(result.stdout).not.toContain('qsecret');
    expect(result.stdout).not.toContain('frag-secret');
  });

  it('shapes a running stack and never emits key material or the DB password', async () => {
    const server = await startHttpServer(200);
    const harness = newHarness();
    harness.track(() => server.close());
    harness.setStatusFixture(
      stackStatusFixture({
        apiUrl: server.url,
        apiPort: server.port,
        dbUrl: 'postgresql://postgres:fixture-db-password@127.0.0.1:30040/postgres',
      }),
    );

    const result = await harness.run(['status', '--json'], {
      APP_PORT: String(server.port),
      APP_URL: server.url,
      // Must be ignored: the stack's own runtime is authoritative.
      SUPABASE_RUNTIME: 'docker',
    });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    const ports = objectField(status, 'ports');
    const urls = objectField(status, 'urls');
    const supabase = objectField(status, 'supabase');
    const web = objectField(status, 'web');
    const stack = objectField(status, 'stack');
    const build = objectField(status, 'build');

    expect(status.ready).toBe(true);
    expect(status.stackId).toContain('fixture-stack-id');
    expect(status.runtime).toBe('native');
    expect(status.branch).toBe('refs/heads/feat/env-fixture');
    expect(status.mode).toBe('default');
    expect(status.projectId).toBe(`stack-${'fixture-stack-id'.slice(0, 12)}`);
    expect(ports.app).toBe(server.port);
    expect(ports.api).toBe(server.port);
    expect(ports.db).toBe(30040);
    expect(ports.studio).toBe(31136);
    expect(ports.mail).toBe(20503);
    expect(ports.mailSmtp).toBe(20395);
    expect(ports.mailPop3).toBe(29709);
    expect(ports.pgmeta).toBe(29285);
    expect(ports.block).toBeNull();
    expect(stack.name).toBe('default');
    expect(stack.branch).toBe('refs/heads/feat/env-fixture');
    expect(urls.supabase).toBe(`http://localhost:${server.port}`);
    expect(urls.db).toBe('postgresql://localhost:30040/postgres');
    expect(status.dbUrl).toBe('postgresql://localhost:30040/postgres');
    expect(supabase).toEqual({ url: `http://localhost:${server.port}`, http: 200 });
    expect(web.http).toBe(200);
    expect(typeof build.present).toBe('boolean');
    expect(build.fingerprint).toBeNull();
    expect('warmMs' in status).toBe(false);

    // No sentinel, key name or password may survive anywhere in stdout.
    expect(result.stdout).not.toContain('fixture-db-password');
    expect(result.stdout).not.toContain('postgres:postgres');
    for (const sentinel of [
      'sentinel-anon-key-value',
      'sentinel-service-role-value',
      'sentinel-publishable-value',
      'sentinel-secret-key-value',
      'sentinel-s3-access-id',
      'sentinel-s3-access-secret',
    ]) {
      expect(result.stdout).not.toContain(sentinel);
    }
    expect(result.stdout).not.toMatch(
      /ANON_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|SECRET_KEY|S3_PROTOCOL/,
    );

    // Read-only: only status/list may ever be asked of the CLI.
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack status --output-format json');
    expect(calls).not.toMatch(/stack (start|stop|destroy|install|logs)/);
  });

  it('reports a broken APP_PORT instead of crashing', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const result = await harness.run(['status', '--json'], { APP_PORT: 'abc' });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    expect(objectField(status, 'ports').app).toBe(3000);
  });

  it('reads an exact fingerprint from isolated build state', async () => {
    const harness = newHarness();
    const fingerprint = '0123456789abcdef0123456789abcdef';
    writeFileSync(
      join(harness.stateDir, 'build.json'),
      JSON.stringify({
        fingerprint,
        envHash: 'fixture-env-hash',
        mode: 'production',
        builtAt: '2026-11-08T00:00:00.000Z',
      }),
    );

    const result = await harness.run(['status', '--json']);
    expect(result.status).toBe(0);
    const build = objectField(parseJsonObject(result.stdout), 'build');
    expect(build.fingerprint).toBe(fingerprint);
  });

  it('reads ownership and mode from the registry in shared mode', async () => {
    const server = await startHttpServer(200);
    const harness = newHarness();
    harness.track(() => server.close());
    const projectId = 'studiq-fixture-checkout-00112233';
    harness.writeRegistryEntry({
      projectId,
      worktree: '/tmp/another-checkout',
      appPort: 3210,
      apiPort: 54321,
      ownerPid: 0,
      startedAt: '2026-11-08T00:00:00Z',
      shared: true,
      sharedOwner: 'qa-crew',
      mode: 'prod',
      claimId: 'fixture-claim',
    });

    const result = await harness.run(['status', '--json'], {
      SUPABASE_SHARED: '1',
      SUPABASE_PROJECT_ID: projectId,
      SUPABASE_SHARED_OWNER: 'qa-crew',
      SUPABASE_URL: server.url,
      SUPABASE_API_PORT: '4321',
      APP_PORT: String(server.port),
      APP_URL: server.url,
    });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    const ports = objectField(status, 'ports');
    const urls = objectField(status, 'urls');
    const supabase = objectField(status, 'supabase');

    expect(status.shared).toBe(true);
    expect(status.sharedOwner).toBe('qa-crew');
    expect(status.projectId).toBe(projectId);
    expect(status.mode).toBe('prod');
    expect(status.owner).toBe('/tmp/another-checkout');
    expect(status.stack).toBeNull();
    expect(status.stackId).toBeNull();
    expect(ports.api).toBe(4321);
    expect(urls.supabase).toBe(`http://localhost:${server.port}`);
    expect(supabase.http).toBe(200);
    expect(result.stdout).not.toContain('fixture-claim');
  });

  it('reports owner null for a registry entry without a worktree', async () => {
    const harness = newHarness();
    const projectId = 'studiq-fixture-no-worktree-77889900';
    harness.writeRegistryEntry({
      projectId,
      worktree: '',
      mode: 'dev',
    });

    const result = await harness.run(['status', '--json'], {
      SUPABASE_SHARED: '1',
      SUPABASE_PROJECT_ID: projectId,
      SUPABASE_URL: 'http://127.0.0.1:1',
      APP_PORT: '3298',
    });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    expect(status.owner).toBeNull();
    expect(status.mode).toBe('dev');
  });

  it('ignores registry entries whose id does not match their file name', async () => {
    const harness = newHarness();
    const projectId = 'studiq-fixture-mismatched-44556677';
    harness.writeRawEntry(`${projectId}.json`, {
      projectId: 'studiq-some-other-id',
      worktree: '/tmp/another-checkout',
      mode: 'prod',
    });

    const result = await harness.run(['status', '--json'], {
      SUPABASE_SHARED: '1',
      SUPABASE_PROJECT_ID: projectId,
      SUPABASE_URL: 'http://127.0.0.1:1',
      APP_PORT: '3299',
    });

    expect(result.status).toBe(0);
    const status = parseJsonObject(result.stdout);
    expect(status.owner).toBeNull();
    expect(status.mode).toBeNull();
  });

  it('rejects unknown flags with exit code 2', async () => {
    const harness = newHarness();
    const result = await harness.run(['status', '--nope']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--nope'");
  });

  it('documents the surface with --help', async () => {
    const harness = newHarness();
    const result = await harness.run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('env:status');
    expect(result.stdout).toContain('env:supa');
  });
});
