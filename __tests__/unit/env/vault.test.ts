import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface VaultModule {
  scaffoldLocalEnv(root: string, force?: boolean): 'created' | 'overwritten' | 'unchanged';
  scaffoldVault(root: string, force?: boolean): 'created' | 'overwritten' | 'unchanged';
  vaultFilePath(root: string): string;
  primaryCheckout(root: string): string;
}

const vault = await loadEnvModule<VaultModule>('lib/vault.ts');
const root = mkdtempSync(join(tmpdir(), 'studiq-env-vault-'));
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

  it('honours STUDIQ_ENV_VAULT and falls back to the primary checkout', () => {
    process.env.STUDIQ_ENV_VAULT = join(root, 'custom.vault');
    expect(vault.vaultFilePath(root)).toBe(join(root, 'custom.vault'));
    delete process.env.STUDIQ_ENV_VAULT;
    expect(vault.vaultFilePath(root)).toBe(join(vault.primaryCheckout(root), '.env.vault'));
  });
});
