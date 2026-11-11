import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { hermeticGitEnv } from '#test/helpers/hermetic-git';
import { loadEnvModule } from '#test/unit/env/load';

interface FingerprintModule {
  buildEnvHash(env: { supabaseUrl: string; siteUrl: string; anonKey: string }): string;
  workingTreeHash(root: string): string;
  computeBuildFingerprint(input: {
    root: string;
    mode: string;
    envHash: string;
    treeHash?: string;
  }): string;
}

const fingerprint = await loadEnvModule<FingerprintModule>('lib/fingerprint.ts');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: string[]): string {
  const result = spawnSync(
    'git',
    ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      encoding: 'utf8',
      env: {
        ...hermeticGitEnv(),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Env Test',
        GIT_AUTHOR_EMAIL: 'env@example.test',
        GIT_COMMITTER_NAME: 'Env Test',
        GIT_COMMITTER_EMAIL: 'env@example.test',
      },
    },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'studiq-env-fingerprint-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const value = 1;\n');
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, ['commit', '--no-verify', '-qm', 'init']);
  return root;
}

describe('build fingerprint (spec §8)', () => {
  it('hashes the inlined public values and the build mode', () => {
    const base = {
      supabaseUrl: 'http://localhost:20041',
      siteUrl: 'http://localhost:3000',
      anonKey: 'anon-one',
    };
    const hash = fingerprint.buildEnvHash(base);
    expect(hash).toBe(fingerprint.buildEnvHash({ ...base }));
    expect(hash).not.toBe(fingerprint.buildEnvHash({ ...base, anonKey: 'anon-two' }));
    expect(hash).not.toBe(fingerprint.buildEnvHash({ ...base, siteUrl: 'http://localhost:3011' }));

    const one = fingerprint.computeBuildFingerprint({
      root: '/tmp',
      mode: 'production',
      envHash: hash,
      treeHash: 'tree',
    });
    const two = fingerprint.computeBuildFingerprint({
      root: '/tmp',
      mode: 'production',
      envHash: hash,
      treeHash: 'other-tree',
    });
    expect(one).not.toBe(two);
  });

  it('invalidates the build on a second edit to the same modified file', () => {
    const root = repo();
    const path = join(root, 'src', 'app.ts');

    writeFileSync(path, 'export const value = 2;\n');
    const statusAfterFirst = git(root, ['status', '--porcelain']);
    const first = fingerprint.workingTreeHash(root);

    writeFileSync(path, 'export const value = 3;\n');
    const statusAfterSecond = git(root, ['status', '--porcelain']);
    const second = fingerprint.workingTreeHash(root);

    // The CLI's old fingerprint inputs are identical; only content hashing sees it.
    expect(statusAfterSecond).toBe(statusAfterFirst);
    expect(second).not.toBe(first);
  });

  it('includes build-relevant untracked source files', () => {
    const root = repo();
    const before = fingerprint.workingTreeHash(root);
    writeFileSync(join(root, 'src', 'new.ts'), 'export const added = true;\n');
    const after = fingerprint.workingTreeHash(root);
    expect(after).not.toBe(before);
  });

  it('fails closed when git cannot read the working tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'studiq-env-not-a-repo-'));
    roots.push(root);
    expect(() => fingerprint.workingTreeHash(root)).toThrow(/git .* failed|not a git repository/);
  });

  it('is stable when nothing changes', () => {
    const root = repo();
    expect(fingerprint.workingTreeHash(root)).toBe(fingerprint.workingTreeHash(root));
    expect(
      fingerprint.computeBuildFingerprint({
        root,
        mode: 'production',
        envHash: 'env',
      }),
    ).toBe(
      fingerprint.computeBuildFingerprint({
        root,
        mode: 'production',
        envHash: 'env',
      }),
    );
  });
});
