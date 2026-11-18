import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  objectField,
  parseJsonObject,
  stackStatusFixture,
  stoppedStackFixture,
  stringList,
  type Harness,
} from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface ProductionBuildModule {
  runProductionBuild(
    envHash: string,
    deps: {
      readWebPid(): number | null;
      spawnBuild(slot: unknown): Promise<{
        status: number | null;
        timedOut: boolean;
        output: string;
      }>;
      artifactDir?: string;
    },
  ): Promise<{ ok: boolean }>;
}

// `manifest.ts` captures `.dev/` at import time; the in-process build below
// writes into this directory, so it must be set before the module is loaded.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-manifest-'));
const registryDir = mkdtempSync(join(tmpdir(), 'studiq-env-manifest-registry-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
process.env.STUDIQ_DEV_REGISTRY = registryDir;

const buildModule = await loadEnvModule<ProductionBuildModule>('lib/build.ts');

const harnesses: Harness[] = [];

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(registryDir, { recursive: true, force: true });
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/** The file a mutating command leaves in the harness's isolated `.dev/`. */
function manifestPath(harness: Harness): string {
  return join(harness.stateDir, 'env.json');
}

function readManifestFile(harness: Harness): Record<string, unknown> {
  return parseJsonObject(readFileSync(manifestPath(harness), 'utf8'));
}

function writeManifestFile(harness: Harness, value: unknown): void {
  writeFileSync(manifestPath(harness), typeof value === 'string' ? value : JSON.stringify(value));
}

/** `.dev/env.json` at a path, as JSON; a missing file fails the read loudly. */
function readJson(path: string): Record<string, unknown> {
  return parseJsonObject(readFileSync(path, 'utf8'));
}

/** A throwaway build artifact directory (never this checkout's `apps/web/.next`). */
function newArtifactDir(): string {
  return mkdtempSync(join(tmpdir(), 'studiq-env-manifest-artifact-'));
}

/** A web build whose spawn the test controls; a fresh artifact dir each time. */
function buildDeps(
  spawn: () => Promise<{ status: number | null; timedOut: boolean; output: string }>,
): {
  readWebPid(): number | null;
  spawnBuild(): Promise<{ status: number | null; timedOut: boolean; output: string }>;
  artifactDir: string;
} {
  return {
    readWebPid: () => null,
    spawnBuild: spawn,
    artifactDir: join(newArtifactDir(), '.next'),
  };
}

describe('.dev/env.json is written by a state change and never by a read', () => {
  it('is written by down and left untouched by status and doctor', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());

    const down = await harness.run(['down']);
    expect(down.status, down.stderr).toBe(0);
    expect(existsSync(manifestPath(harness))).toBe(true);

    const manifest = readManifestFile(harness);
    // The schema number is the published contract: a change here is a change
    // every reader of `.dev/env.json` has to notice.
    expect(manifest.schema).toBe(1);
    expect(manifest.writtenAt).toEqual(expect.any(String));
    const checkout = objectField(manifest, 'checkout');
    expect(checkout.worktree).toEqual(expect.any(String));
    expect(typeof checkout.primary).toBe('boolean');
    const app = objectField(manifest, 'app');
    expect(app.serving).toBe(false);
    expect(app.port).toBe(3000);
    expect(app.pid).toBeNull();
    expect(objectField(manifest, 'stack').running).toBe(false);
    expect(manifest.building).toBeNull();
    expect(objectField(manifest, 'next')).toEqual({
      build: 'bun run env:build',
      serve: 'bun run env:serve',
      // Plain `down`: `build` refuses while a server runs, and `--all` would
      // leave no stack for the next `build`.
      down: 'bun run env:down',
    });

    // Read-only commands reconcile, they never rewrite: the same bytes and the
    // same mtime, or "status is authoritative" would mean "status is a writer".
    const before = readFileSync(manifestPath(harness), 'utf8');
    const beforeMtime = statSync(manifestPath(harness)).mtimeMs;
    const status = await harness.run(['status', '--json']);
    expect(status.status, status.stderr).toBe(0);
    const doctor = await harness.run(['doctor', '--json']);
    expect(doctor.stdout + doctor.stderr).not.toBe('');
    expect(readFileSync(manifestPath(harness), 'utf8')).toBe(before);
    expect(statSync(manifestPath(harness)).mtimeMs).toBe(beforeMtime);
  });

  it('is written by a serve that refuses after resolving the stack', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );

    // `serve` can stop a recorded server before it discovers the artifact is not
    // servable (or that the port belongs to another process). The write has to
    // survive that exit, or `app.serving` keeps naming a server this command
    // stopped — the exact false belief the file exists to prevent.
    const result = await harness.run(['serve']);
    expect(result.status, result.stderr).not.toBe(0);

    expect(existsSync(manifestPath(harness))).toBe(true);
    const manifest = readManifestFile(harness);
    expect(manifest.schema).toBe(1);
    expect(objectField(manifest, 'app').serving).toBe(false);
    expect(objectField(manifest, 'app').pid).toBeNull();
    expect(manifest.building).toBeNull();
  });

  it('names a next command that is valid in the state it describes', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    expect((await harness.run(['down'])).status).toBe(0);

    const next = objectField(readManifestFile(harness), 'next');
    expect(next).toEqual({
      build: 'bun run env:build',
      serve: 'bun run env:serve',
      down: 'bun run env:down',
    });
    // `next.down` is the command the tool actually asks for (`build` refuses
    // while a server runs), and running it must be accepted in this state.
    const again = await harness.run(['down']);
    expect(again.status, again.stderr).toBe(0);
  });

  it('reports an absent file as never recorded, not as unknown state', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());

    const json = await harness.run(['status', '--json']);
    expect(json.status, json.stderr).toBe(0);
    const manifest = objectField(parseJsonObject(json.stdout), 'manifest');
    expect(manifest).toEqual({
      present: false,
      schema: null,
      writtenAt: null,
      agrees: null,
      differences: [],
      error: null,
    });

    const text = await harness.run(['status']);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('no command has recorded state here yet');
    expect(text.stdout).toContain('env:ensure --profile web');
  });
});

describe('.dev/env.json is reconciled by status, never echoed', () => {
  it('reports a file that disagrees with the live probe as stale', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    expect((await harness.run(['down'])).status).toBe(0);

    const tampered = readManifestFile(harness);
    objectField(tampered, 'app').port = 3001;
    writeManifestFile(harness, tampered);

    const result = await harness.run(['status', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const status = parseJsonObject(result.stdout);
    const manifest = objectField(status, 'manifest');
    expect(manifest.present).toBe(true);
    expect(manifest.agrees).toBe(false);
    // The live port wins: status reports its own number, not the file's claim.
    expect(objectField(status, 'ports').app).toBe(3000);
    expect(stringList(manifest.differences).join('\n')).toContain(
      'app.port: the file says 3001, live says 3000',
    );

    const text = await harness.run(['status']);
    expect(text.stdout).toContain('manifest    stale:');
    expect(text.stdout).toContain('app.port');
    // Reconciling is not rewriting: the disagreement survives the read.
    expect(objectField(readManifestFile(harness), 'app').port).toBe(3001);
  });

  it('reports a corrupt file instead of throwing, and still answers', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    writeManifestFile(harness, '{"schema": 1, "app":');

    const result = await harness.run(['status', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = objectField(parseJsonObject(result.stdout), 'manifest');
    expect(manifest.present).toBe(true);
    expect(manifest.agrees).toBeNull();
    expect(manifest.error).toEqual(expect.any(String));

    const text = await harness.run(['status']);
    expect(text.stdout).toContain('manifest    unreadable:');
  });

  it('reports a failed stack probe as unknown, not as a disagreement', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    expect((await harness.run(['down'])).status).toBe(0);

    // A lie the probe cannot check: with a working probe this is stale. The
    // probe is the call that motivated the file (#1360), so its failure must be
    // reported as unknown instead of accusing the file of being wrong — for
    // every stack fact, not just `running`.
    const tampered = readManifestFile(harness);
    Object.assign(objectField(tampered, 'stack'), {
      id: 'stale-id-from-the-file',
      runtime: 'docker',
      running: true,
    });
    writeManifestFile(harness, tampered);
    harness.setRawStatus('{"identity":');

    const result = await harness.run(['status', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const status = parseJsonObject(result.stdout);
    const manifest = objectField(status, 'manifest');
    expect(stringList(manifest.differences).join('\n')).not.toContain('stack.');
    expect(manifest.agrees).toBe(true);
    expect(stringList(status.warnings).join('\n')).toContain("cannot read 'supabase stack status'");
  });

  it('reports a wrong checkout branch even when the commit matches', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    expect((await harness.run(['down'])).status).toBe(0);

    const tampered = readManifestFile(harness);
    objectField(tampered, 'checkout').branch = 'feat/not-this-branch';
    writeManifestFile(harness, tampered);

    const result = await harness.run(['status', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = objectField(parseJsonObject(result.stdout), 'manifest');
    expect(manifest.agrees).toBe(false);
    expect(stringList(manifest.differences).join('\n')).toContain(
      'checkout.branch: the file says feat/not-this-branch',
    );
  });

  it('refuses to read a newer schema as if it were this one', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    writeManifestFile(harness, { schema: 2, writtenAt: '2026-11-18T00:00:00.000Z' });

    const result = await harness.run(['status', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = objectField(parseJsonObject(result.stdout), 'manifest');
    expect(manifest.present).toBe(true);
    expect(manifest.schema).toBe(2);
    expect(manifest.agrees).toBe(false);
    expect(stringList(manifest.differences).join('\n')).toContain('schema: the file is 2');
  });
});

describe('.dev/env.json never carries a secret', () => {
  it('holds no key material and no database URL for a running stack', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({
        apiUrl: 'http://127.0.0.1:20041',
        apiPort: 20041,
        dbUrl:
          'postgresql://postgres:fixture-db-password@127.0.0.1:30040/postgres?password=query-secret',
      }),
    );

    // Plain `down` over a running stack keeps it, so the manifest records the
    // stack facts of a live environment — the case that has the most to leak.
    const down = await harness.run(['down']);
    expect(down.status, down.stderr).toBe(0);

    const raw = readFileSync(manifestPath(harness), 'utf8');
    expect(raw).not.toContain('postgresql://');
    expect(raw).not.toContain('fixture-db-password');
    expect(raw).not.toContain('query-secret');
    for (const sentinel of [
      'sentinel-anon-key-value',
      'sentinel-service-role-value',
      'sentinel-publishable-value',
      'sentinel-secret-key-value',
      'sentinel-s3-access-id',
      'sentinel-s3-access-secret',
    ]) {
      expect(raw).not.toContain(sentinel);
    }
    expect(raw).not.toMatch(/ANON_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|SECRET_KEY|S3_PROTOCOL/);
    // The stack facts it may name are identity, not credentials.
    expect(objectField(readManifestFile(harness), 'stack').running).toBe(true);
  });
});

describe('building names the live build and never outlives it', () => {
  it('is set while the build holds the mutex and cleared after it', async () => {
    const seen: { building?: Record<string, unknown> } = {};
    await buildModule.runProductionBuild(
      'env-hash',
      buildDeps(() => {
        seen.building = objectField(readJson(join(stateDir, 'env.json')), 'building');
        return Promise.resolve({ status: 0, timedOut: false, output: '' });
      }),
    );

    expect(seen.building?.pid).toBe(process.pid);
    expect(seen.building?.slot).toBe(1);
    expect(typeof seen.building?.start).toBe('string');
    expect(readJson(join(stateDir, 'env.json')).building).toBeNull();
  });

  it('is cleared after a failed build, not left naming a dead pid', async () => {
    const result = await buildModule.runProductionBuild(
      'env-hash',
      buildDeps(() => Promise.resolve({ status: 1, timedOut: false, output: 'Type error: nope' })),
    );

    expect(result.ok).toBe(false);
    expect(readJson(join(stateDir, 'env.json')).building).toBeNull();
  });

  it('is cleared when the build throws instead of returning', async () => {
    await expect(
      buildModule.runProductionBuild(
        'env-hash',
        buildDeps(() => Promise.reject(new Error('spawn failed'))),
      ),
    ).rejects.toThrow('spawn failed');
    expect(readJson(join(stateDir, 'env.json')).building).toBeNull();
  });
});
