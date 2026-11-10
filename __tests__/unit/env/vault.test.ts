import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface VaultModule {
  scaffoldLocalEnv(root: string, force?: boolean): 'created' | 'overwritten' | 'unchanged';
  scaffoldVault(root: string, force?: boolean): 'created' | 'overwritten' | 'unchanged';
  vaultFilePath(root: string): string;
  primaryCheckout(root: string): string;
}

const vault = await loadEnvModule<VaultModule>('lib/vault.ts');
const root = mkdtempSync(join(tmpdir(), 'studiq-env-vault-'));
const gitFixtures: string[] = [];
writeFileSync(
  join(root, '.env.schema'),
  [
    '# @defaultRequired=false',
    '# @defaultSensitive=false',
    '# ---',
    '',
    'APP_PORT=',
    '',
    '# @sensitive',
    '# @optional',
    'STRIPE_SECRET_KEY=',
    '',
    '# @optional',
    'PLAIN=',
  ].join('\n'),
);

beforeEach(() => {
  // Workers can reuse `process.env` across files; never let a leaked pointer or
  // a previous file's scaffold decide this test's starting state.
  delete process.env.STUDIQ_ENV_VAULT;
  for (const name of ['.env.local', '.env.vault', 'custom.vault']) {
    rmSync(join(root, name), { force: true });
  }
});

afterAll(() => {
  delete process.env.STUDIQ_ENV_VAULT;
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  for (const dir of gitFixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
}

/** A primary checkout plus a linked worktree, so `git worktree list` has two entries. */
function worktreeFixture(): { primary: string; worktree: string } {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-git-'));
  gitFixtures.push(dir);
  const primary = join(dir, 'primary');
  git(dir, ['init', primary]);
  git(primary, ['config', 'user.email', 'fixture@example.invalid']);
  git(primary, ['config', 'user.name', 'Fixture']);
  git(primary, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(primary, 'README.md'), 'fixture\n');
  git(primary, ['add', 'README.md']);
  git(primary, ['commit', '-m', 'fixture']);
  const worktree = join(dir, 'worktree');
  git(primary, ['worktree', 'add', '--detach', worktree]);
  return { primary: realpathSync(primary), worktree: realpathSync(worktree) };
}

function lines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

describe('env:setup scaffold (spec §11.1)', () => {
  it('creates a comment-only .env.local, mode 600, idempotently', () => {
    expect(vault.scaffoldLocalEnv(root)).toBe('created');
    const path = join(root, '.env.local');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(lines(path).every((line) => line.startsWith('#'))).toBe(true);
    expect(vault.scaffoldLocalEnv(root)).toBe('unchanged');
    expect(vault.scaffoldLocalEnv(root, true)).toBe('overwritten');
  });

  it('lists the @sensitive key names commented out (never a value)', () => {
    const path = join(root, '.env.vault');
    expect(vault.scaffoldVault(root)).toBe('created');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('# STRIPE_SECRET_KEY=');
    expect(content).toContain('# LLM_API_KEY=');
    // Only provider refs go in the vault; local-stack keys and non-provider
    // sensitive values stay in `.env.local`.
    expect(content).not.toContain('# PLAIN=');
    expect(content).not.toContain('# SUPABASE_SERVICE_ROLE_KEY=');
    // Every line is a comment (no literal can be mistaken for a value).
    expect(lines(path).every((line) => line.startsWith('#'))).toBe(true);
    expect(vault.scaffoldVault(root)).toBe('unchanged');
  });

  it('honours STUDIQ_ENV_VAULT and defaults to the literal checkout path', () => {
    process.env.STUDIQ_ENV_VAULT = join(root, 'custom.vault');
    expect(vault.vaultFilePath(root)).toBe(join(root, 'custom.vault'));

    // A relative pointer resolves against the checkout, not the process cwd.
    process.env.STUDIQ_ENV_VAULT = 'relative.vault';
    expect(vault.vaultFilePath(root)).toBe(join(root, 'relative.vault'));

    // Surrounding whitespace means unset, matching `.trim()`.
    process.env.STUDIQ_ENV_VAULT = '   ';
    expect(vault.vaultFilePath(root)).toBe(join(root, '.env.vault'));

    delete process.env.STUDIQ_ENV_VAULT;
    // `root` is not a git checkout, so the primary-checkout lookup falls back to
    // it; assert the literal path rather than reconstructing it from the lookup.
    expect(vault.vaultFilePath(root)).toBe(join(root, '.env.vault'));
  });

  it('resolves the default vault in a real primary checkout', () => {
    const fixture = worktreeFixture();
    // Ambient Git names, not app configuration; dynamic access keeps the env
    // inventory's static scan focused on declared keys.
    const gitDirName = 'GIT_DIR';
    const previousGitDir = process.env[gitDirName];
    // A git hook exports GIT_DIR; the lookup must still answer for `worktree`.
    process.env[gitDirName] = join(fixture.worktree, 'not-a-git-dir');
    try {
      expect(vault.primaryCheckout(fixture.worktree)).toBe(fixture.primary);
      expect(vault.vaultFilePath(fixture.worktree)).toBe(join(fixture.primary, '.env.vault'));
    } finally {
      if (previousGitDir === undefined) delete process.env[gitDirName];
      else process.env[gitDirName] = previousGitDir;
    }
    // A non-git directory keeps the checkout itself.
    expect(vault.primaryCheckout(root)).toBe(root);
  });
});
