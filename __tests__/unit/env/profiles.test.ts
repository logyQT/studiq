import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface ProfilesModule {
  PROFILES: Record<string, { capabilities: string[]; build: boolean; serve: boolean }>;
  PROFILE_NAMES: string[];
  buildCapabilities(profile: string, atoms: string[]): Set<string>;
  excludesFor(capabilities: Iterable<string>): string[];
  missingCapabilities(observed: Iterable<string>, requested: Iterable<string>): string[];
  profileRequiresServe(profile: string | null | undefined): boolean;
}

const profiles = await loadEnvModule<ProfilesModule>('profiles.ts');

describe('env profiles (phase 2)', () => {
  it('exposes only api and web', () => {
    expect([...profiles.PROFILE_NAMES]).toEqual(['api', 'web']);
    expect(Object.keys(profiles.PROFILES).toSorted()).toEqual(['api', 'web']);
  });

  it('keeps database, auth and storage in every profile', () => {
    for (const name of profiles.PROFILE_NAMES) {
      expect([...(profiles.PROFILES[name]?.capabilities ?? [])].toSorted()).toEqual(
        expect.arrayContaining(['auth', 'database', 'storage']),
      );
    }
  });

  it('maps api to rest without mail, and web to mail', () => {
    expect(profiles.PROFILES.api?.capabilities).toContain('rest');
    expect(profiles.PROFILES.api?.capabilities).not.toContain('mail');
    expect(profiles.PROFILES.web?.capabilities).toContain('mail');
  });

  it('only web builds and serves', () => {
    expect(profiles.PROFILES.api).toMatchObject({ build: false, serve: false });
    expect(profiles.PROFILES.web).toMatchObject({ build: true, serve: true });
  });

  it('derives the exact -x exclude list from capabilities', () => {
    expect(profiles.excludesFor(profiles.PROFILES.api?.capabilities ?? [])).toEqual([
      'studio',
      'mail',
      'realtime',
      'functions',
      'analytics',
      'pooler',
    ]);
    expect(profiles.excludesFor(profiles.PROFILES.web?.capabilities ?? [])).toEqual([
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

  it('adds studio without requiring a second atom (every profile has rest)', () => {
    expect(() => profiles.buildCapabilities('api', ['studio'])).not.toThrow();
  });

  it('reports requested capabilities the stack is missing', () => {
    expect(profiles.missingCapabilities(['database', 'auth'], ['mail'])).toEqual(['mail']);
  });

  it('derives serve from the profile table', () => {
    for (const name of profiles.PROFILE_NAMES) {
      expect(profiles.profileRequiresServe(name)).toBe(profiles.PROFILES[name]?.serve);
    }
    expect(profiles.profileRequiresServe(null)).toBe(false);
    expect(profiles.profileRequiresServe(undefined)).toBe(false);
    expect(profiles.profileRequiresServe('unknown')).toBe(false);
  });
});
