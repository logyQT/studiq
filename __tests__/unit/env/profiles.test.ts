import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface ProfileSpec {
  capabilities: string[];
  seed: boolean;
  build: boolean;
  serve: boolean;
}

interface ProfilesModule {
  PROFILES: Record<string, ProfileSpec>;
  PROFILE_NAMES: string[];
  buildCapabilities(profile: string, atoms: string[]): Set<string>;
  excludesFor(capabilities: Iterable<string>): string[];
  missingCapabilities(observed: Iterable<string>, requested: Iterable<string>): string[];
  profileRequiresServe(profile: string | null | undefined): boolean;
  profileSeeds(profile: string | null | undefined): boolean;
}

const profiles = await loadEnvModule<ProfilesModule>('profiles.ts');

describe('env profiles (phase 3)', () => {
  it('exposes exactly the documented v1 profile set', () => {
    expect([...profiles.PROFILE_NAMES]).toEqual(['db', 'api', 'mail', 'full', 'web', 'qa', 'e2e']);
    expect(Object.keys(profiles.PROFILES).toSorted()).toEqual([
      'api',
      'db',
      'e2e',
      'full',
      'mail',
      'qa',
      'web',
    ]);
  });

  it('keeps database, auth and storage in every profile', () => {
    for (const name of profiles.PROFILE_NAMES) {
      expect([...(profiles.PROFILES[name]?.capabilities ?? [])].toSorted()).toEqual(
        expect.arrayContaining(['auth', 'database', 'storage']),
      );
    }
  });

  it('layers rest and mail on the db profile', () => {
    expect(profiles.PROFILES.db?.capabilities).not.toContain('rest');
    expect(profiles.PROFILES.api?.capabilities).toContain('rest');
    expect(profiles.PROFILES.api?.capabilities).not.toContain('mail');
    expect(profiles.PROFILES.mail?.capabilities).toContain('mail');
    expect(profiles.PROFILES.full?.capabilities).toContain('mail');
  });

  it('builds and serves only web/qa/e2e, and seeds only qa/e2e', () => {
    for (const name of profiles.PROFILE_NAMES) {
      const spec = profiles.PROFILES[name];
      expect(spec.build).toBe(name === 'web' || name === 'qa' || name === 'e2e');
      expect(spec.serve).toBe(name === 'web' || name === 'qa' || name === 'e2e');
      expect(spec.seed).toBe(name === 'qa' || name === 'e2e');
    }
  });

  it('derives the exact -x exclude list from capabilities', () => {
    expect(profiles.excludesFor(profiles.PROFILES.db?.capabilities ?? [])).toEqual([
      'rest',
      'studio',
      'mail',
      'realtime',
      'functions',
      'analytics',
      'pooler',
    ]);
    expect(profiles.excludesFor(profiles.PROFILES.api?.capabilities ?? [])).toEqual([
      'studio',
      'mail',
      'realtime',
      'functions',
      'analytics',
      'pooler',
    ]);
    expect(profiles.excludesFor(profiles.PROFILES.full?.capabilities ?? [])).toEqual([
      'studio',
      'realtime',
      'functions',
      'analytics',
      'pooler',
    ]);
  });

  it('adds capability atoms without removing profile capabilities', () => {
    const caps = profiles.buildCapabilities('api', ['studio']);
    expect(caps.has('database')).toBe(true);
    expect(caps.has('rest')).toBe(true);
    expect(caps.has('studio')).toBe(true);
    expect(profiles.excludesFor(caps)).toEqual([
      'mail',
      'realtime',
      'functions',
      'analytics',
      'pooler',
    ]);
  });

  it('rejects studio on a profile without rest', () => {
    expect(() => profiles.buildCapabilities('db', ['studio'])).toThrow(/requires '--rest'/);
    expect(() => profiles.buildCapabilities('api', ['studio'])).not.toThrow();
  });

  it('accepts realtime and analytics atoms and removes them from -x', () => {
    const caps = profiles.buildCapabilities('api', ['realtime', 'analytics']);
    expect(caps.has('realtime')).toBe(true);
    expect(caps.has('analytics')).toBe(true);
    expect(profiles.excludesFor(caps)).toEqual(['studio', 'mail', 'functions', 'pooler']);
  });

  it('accepts the functions atom and removes functions from -x', () => {
    const caps = profiles.buildCapabilities('api', ['functions']);
    expect(caps.has('functions')).toBe(true);
    expect(profiles.excludesFor(caps)).toEqual([
      'studio',
      'mail',
      'realtime',
      'analytics',
      'pooler',
    ]);
  });

  it('reports requested capabilities the stack is missing', () => {
    expect(profiles.missingCapabilities(['database', 'auth'], ['mail'])).toEqual(['mail']);
  });

  it('derives serve and seed from the profile table', () => {
    for (const name of profiles.PROFILE_NAMES) {
      expect(profiles.profileRequiresServe(name)).toBe(profiles.PROFILES[name]?.serve);
      expect(profiles.profileSeeds(name)).toBe(profiles.PROFILES[name]?.seed);
    }
    for (const value of [null, undefined, 'unknown']) {
      expect(profiles.profileRequiresServe(value)).toBe(false);
      expect(profiles.profileSeeds(value)).toBe(false);
    }
  });
});
