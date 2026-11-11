import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';
import { BUN, REPO_ROOT } from '#test/unit/env/support';

interface SeedModule {
  runSeeder(profile: string, env: NodeJS.ProcessEnv): void;
  SEED_TARGET_LOCKED: string;
}

interface LoadedEnv {
  url: string | null;
  db: string | null;
}

const seed = await loadEnvModule<SeedModule>('lib/seed.ts');
const CLI_URL = pathToFileURL(join(REPO_ROOT, 'scripts', 'seed', 'cli.ts')).href;

const CHECKOUT_URL = 'http://127.0.0.1:3999';
const CHECKOUT_DB_URL = 'postgresql://postgres:pw@127.0.0.1:3999/postgres';
const QA_URL = 'http://127.0.0.1:54421';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function seederEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: CHECKOUT_URL,
    SUPABASE_DB_URL: CHECKOUT_DB_URL,
  };
  // The checked-stack marker is set per test, never inherited from the runner.
  delete env[seed.SEED_TARGET_LOCKED];
  return { ...env, ...extra };
}

/** A root with only `qa/env.json`, so the shared-stack override is observable. */
function qaRoot(): string {
  const root = tempDir('studiq-seed-root-');
  mkdirSync(join(root, 'qa'), { recursive: true });
  writeFileSync(join(root, 'qa', 'env.json'), JSON.stringify({ supabaseUrl: QA_URL }));
  return root;
}

function runLoadEnv(root: string, env: NodeJS.ProcessEnv): LoadedEnv {
  const script = [
    `import { loadEnv } from ${JSON.stringify(CLI_URL)};`,
    `loadEnv(${JSON.stringify(root)});`,
    'process.stdout.write(JSON.stringify({',
    '  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,',
    '  db: process.env.SUPABASE_DB_URL ?? null,',
    '}));',
  ].join('\n');
  const result = spawnSync(BUN, ['-e', script], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return parseLoadedEnv(result.stdout);
}

function parseLoadedEnv(raw: string): LoadedEnv {
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !('url' in parsed) ||
    !('db' in parsed)
  ) {
    throw new Error('expected the seeder probe to print a JSON object');
  }
  const { url, db } = parsed;
  if ((url !== null && typeof url !== 'string') || (db !== null && typeof db !== 'string')) {
    throw new Error('expected the seeder probe to print string or null endpoints');
  }
  return { url, db };
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('seeder target binding', () => {
  it('marks the checked-stack seeder child and leaves the caller env untouched', () => {
    const dir = tempDir('studiq-seed-bin-');
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const markerFile = join(dir, 'marker.txt');
    const fakeBun = join(bin, 'bun');
    writeFileSync(
      fakeBun,
      [
        '#!/usr/bin/env bash',
        'set -eu',
        `printf '%s' "\${${seed.SEED_TARGET_LOCKED}:-unset}" > "$SEED_MARKER_FILE"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    chmodSync(fakeBun, 0o755);

    const env: NodeJS.ProcessEnv = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      SEED_MARKER_FILE: markerFile,
    };
    seed.runSeeder('api', env);

    expect(readFileSync(markerFile, 'utf8')).toBe('1');
    // The marker is for the child only: the caller's process env must not gain it.
    expect(env[seed.SEED_TARGET_LOCKED]).toBeUndefined();
  });

  it('keeps the checked-stack target when the locked marker is set', () => {
    const loaded = runLoadEnv(qaRoot(), seederEnv({ [seed.SEED_TARGET_LOCKED]: '1' }));

    expect(loaded).toEqual({ url: CHECKOUT_URL, db: CHECKOUT_DB_URL });
  });

  it('still applies the qa/env.json override for direct QA seeding', () => {
    const loaded = runLoadEnv(qaRoot(), seederEnv());

    // The shared-stack URL replaces the checkout's, and the direct-Postgres
    // writer is disabled because its endpoint no longer matches.
    expect(loaded).toEqual({ url: QA_URL, db: null });
  });
});
