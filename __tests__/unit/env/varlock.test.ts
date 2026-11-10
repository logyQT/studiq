import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface VarlockItem {
  present: boolean;
  sensitive: boolean;
}

interface VarlockResult {
  ok: boolean;
  exitCode: number | null;
  items: Map<string, VarlockItem>;
  failure: 'locked' | 'missing' | 'timeout' | 'spawn-error' | null;
}

interface VarlockModule {
  classify(stderr: string): 'locked' | 'missing';
  itemsFromPayload(stdout: string): Map<string, VarlockItem>;
  loadVarlock(options: {
    paths: string[] | null;
    root?: string;
    timeoutMs?: number;
  }): VarlockResult;
}

const varlock = await loadEnvModule<VarlockModule>('lib/varlock.ts');

describe('varlock failure classification', () => {
  it.each([
    'varlock: the vault is locked',
    'varlock: lock the credential proxy first',
    'varlock: locking provider access',
    'run `varlock unlock` before loading',
    'biometric authentication failed',
    'keychain denied the request',
    '401 unauthorized',
    '403 forbidden',
    'authentication required',
    'auth required',
    'VAULT LOCKED',
  ])('classifies %j as locked', (stderr) => {
    expect(varlock.classify(stderr)).toBe('locked');
  });

  it.each([
    // The reproduction: words that merely contain the letters are not a refusal.
    'Blocked by the varlock credential proxy: provider unavailable',
    'clock skew detected',
    'the vault is unlocked',
    'invalid value for APP_PORT',
    'no such file or directory: .env.schema',
    '',
  ])('classifies %j as missing', (stderr) => {
    expect(varlock.classify(stderr)).toBe('missing');
  });
});

describe('varlock payload mapping', () => {
  it('keeps names and presence only, including value-less and null-valued items', () => {
    const items = varlock.itemsFromPayload(
      JSON.stringify({
        config: {
          OPTIONAL: { isSensitive: true },
          NULLED: { value: null },
          PRESENT: { value: 'resolved', isSensitive: false },
          IGNORED: null,
          SCALAR: 'not-an-item',
        },
      }),
    );

    expect(items.get('OPTIONAL')).toEqual({ present: false, sensitive: true });
    // An explicit `null` is a resolved value, unlike a missing `value` key.
    expect(items.get('NULLED')).toEqual({ present: true, sensitive: false });
    expect(items.get('PRESENT')).toEqual({ present: true, sensitive: false });
    expect(items.has('IGNORED')).toBe(false);
    expect(items.has('SCALAR')).toBe(false);
    expect(items.size).toBe(3);
  });

  it.each([
    'Blocked by the varlock credential proxy: provider unavailable',
    '{"config":',
    '[]',
    'null',
    '',
  ])('returns an empty map for a non-object payload (%j)', (stdout) => {
    expect(varlock.itemsFromPayload(stdout).size).toBe(0);
  });

  it('ignores a config that is not an object', () => {
    expect(varlock.itemsFromPayload(JSON.stringify({ config: ['APP_PORT'] })).size).toBe(0);
  });
});

describe('loadVarlock failures', () => {
  it('reports a timeout instead of a missing value', () => {
    const result = varlock.loadVarlock({ paths: null, timeoutMs: 1 });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.failure).toBe('timeout');
  });

  it('reports a spawn error when bunx cannot be executed', () => {
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      const result = varlock.loadVarlock({ paths: null });
      expect(result.ok).toBe(false);
      expect(result.failure).toBe('spawn-error');
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
    }
  });
});
