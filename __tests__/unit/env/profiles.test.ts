import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface ProfilesModule {
  PROFILES: Record<
    string,
    {
      capabilities: string[];
      seed: boolean;
      build: boolean;
      serve: boolean;
      availableInPhase2: boolean;
    }
  >;
  PROFILE_NAMES: string[];
  buildCapabilities(profile: string, atoms: string[]): Set<string>;
  excludesFor(capabilities: Iterable<string>): string[];
  isCapabilitySuperset(observed: Iterable<string>, requested: Iterable<string>): boolean;
  missingCapabilities(observed: Iterable<string>, requested: Iterable<string>): string[];
  profileRequiresServe(profile: string | null): boolean;
}

const profiles = await loadEnvModule<ProfilesModule>('profiles.ts');

describe('env profiles (spec §3)', () => {
  it('declares the full table and only api/web are reachable in phase 2', () => {
    expect([...profiles.PROFILE_NAMES].toSorted()).toEqual(
      ['admin', 'api', 'db', 'e2e', 'full', 'mail', 'qa', 'web'].toSorted(),
    );
    const available = Object.entries(profiles.PROFILES)
      .filter(([, spec]) => spec.availableInPhase2)
      .map(([name]) => name)
      .toSorted();
    expect(available).toEqual(['api', 'web']);
  });

  it('maps each profile to the exact -x exclude list', () => {
    const expected: Record<string, string[]> = {
      db: ['rest', 'studio', 'mail', 'realtime', 'functions', 'analytics', 'pooler'],
      api: ['studio', 'mail', 'realtime', 'functions', 'analytics', 'pooler'],
      mail: ['studio', 'realtime', 'functions', 'analytics', 'pooler'],
      full: ['studio', 'realtime', 'functions', 'analytics', 'pooler'],
      web: ['studio', 'realtime', 'functions', 'analytics', 'pooler'],
      qa: ['studio', 'realtime', 'functions', 'analytics', 'pooler'],
      e2e: ['studio', 'realtime', 'functions', 'analytics', 'pooler'],
      admin: ['studio', 'realtime', 'functions', 'analytics', 'pooler'],
    };
    for (const [profile, excludes] of Object.entries(expected)) {
      expect(profiles.excludesFor(profiles.PROFILES[profile]?.capabilities ?? [])).toEqual(
        excludes,
      );
    }
  });

  it('keeps database, auth and storage in db (settled phase-0 decision)', () => {
    expect([...(profiles.PROFILES.db?.capabilities ?? [])].toSorted()).toEqual([
      'auth',
      'database',
      'storage',
    ]);
  });

  it('only web/qa/e2e/admin build and serve; qa/e2e seed', () => {
    const building = Object.entries(profiles.PROFILES)
      .filter(([, spec]) => spec.build)
      .map(([name]) => name)
      .toSorted();
    const serving = Object.entries(profiles.PROFILES)
      .filter(([, spec]) => spec.serve)
      .map(([name]) => name)
      .toSorted();
    const seeding = Object.entries(profiles.PROFILES)
      .filter(([, spec]) => spec.seed)
      .map(([name]) => name)
      .toSorted();
    expect(building).toEqual(['admin', 'e2e', 'qa', 'web']);
    expect(serving).toEqual(['admin', 'e2e', 'qa', 'web']);
    expect(seeding).toEqual(['e2e', 'qa']);
  });

  it('adds capability atoms without removing profile capabilities', () => {
    const caps = profiles.buildCapabilities('api', ['mail', 'studio']);
    expect(caps.has('database')).toBe(true);
    expect(caps.has('rest')).toBe(true);
    expect(caps.has('mail')).toBe(true);
    expect(caps.has('studio')).toBe(true);
    expect(profiles.excludesFor(caps)).not.toContain('mail');
    expect(profiles.excludesFor(caps)).not.toContain('studio');
  });

  it('treats a running superset as satisfying a narrower request', () => {
    const full = profiles.PROFILES.full?.capabilities ?? [];
    const api = profiles.PROFILES.api?.capabilities ?? [];
    expect(profiles.isCapabilitySuperset(full, api)).toBe(true);
    expect(profiles.isCapabilitySuperset(api, full)).toBe(false);
    expect(profiles.missingCapabilities(api, full)).toEqual(['mail']);
  });

  it('marks only served profiles as requiring the web server', () => {
    expect(profiles.profileRequiresServe('web')).toBe(true);
    expect(profiles.profileRequiresServe('qa')).toBe(true);
    expect(profiles.profileRequiresServe('api')).toBe(false);
    expect(profiles.profileRequiresServe(null)).toBe(false);
  });
});
