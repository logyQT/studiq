import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface RepoModule {
  REPO_ROOT: string;
  canon(path: string): string;
  isThisCheckout(path: string | null | undefined): boolean;
}

const repo = await loadEnvModule<RepoModule>('lib/repo.ts');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('checkout identity', () => {
  it('canonicalizes a symlinked project root before comparing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studiq-env-repo-'));
    dirs.push(dir);
    const link = join(dir, 'worktree-link');
    symlinkSync(repo.REPO_ROOT, link, 'dir');

    expect(repo.canon(link)).toBe(repo.REPO_ROOT);
    expect(repo.isThisCheckout(link)).toBe(true);
    expect(repo.isThisCheckout(`${link}/..`)).toBe(false);
    expect(repo.isThisCheckout('/tmp/some-other-checkout')).toBe(false);
    expect(repo.isThisCheckout(null)).toBe(false);
    expect(repo.isThisCheckout(undefined)).toBe(false);
  });
});
