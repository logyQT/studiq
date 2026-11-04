import { describe, expect, it } from 'vitest';
import {
  assertProductionSiteUrl,
  assertSecureSiteUrl,
  isLocalHostname,
  isProductionEnv,
  resolveAppEnv,
  AppEnvError,
} from '@studiq/server/lib/app-env';

describe('resolveAppEnv', () => {
  it('defaults to production when APP_ENV is unset or blank', () => {
    expect(resolveAppEnv({})).toBe('production');
    expect(resolveAppEnv({ APP_ENV: '' })).toBe('production');
    expect(resolveAppEnv({ APP_ENV: '   ' })).toBe('production');
  });

  it.each(['production', 'development', 'test', 'qa'] as const)('accepts %s', (value) => {
    expect(resolveAppEnv({ APP_ENV: value })).toBe(value);
  });

  it('is case-insensitive and trims', () => {
    expect(resolveAppEnv({ APP_ENV: ' QA ' })).toBe('qa');
  });

  it('rejects an unknown posture instead of guessing', () => {
    expect(() => resolveAppEnv({ APP_ENV: 'staging' })).toThrow(AppEnvError);
    expect(() => resolveAppEnv({ APP_ENV: 'production ' })).not.toThrow();
  });

  it('reports production only for the production posture', () => {
    expect(isProductionEnv({})).toBe(true);
    expect(isProductionEnv({ APP_ENV: 'qa' })).toBe(false);
  });
});

describe('isLocalHostname', () => {
  it.each([
    'localhost',
    'app.localhost',
    'localhost.',
    '127.0.0.1',
    '127.0.0.2',
    '::1',
    '[::1]',
    '::',
    '[::]',
    '[::ffff:127.0.0.1]',
    '0.0.0.0',
  ])('flags %s as loopback', (host) => {
    expect(isLocalHostname(host)).toBe(true);
  });

  it('accepts a real hostname', () => {
    expect(isLocalHostname('studiq.app')).toBe(false);
    expect(isLocalHostname('127.example.com')).toBe(false);
  });
});

describe('assertSecureSiteUrl', () => {
  it('accepts an https origin and returns the normalized origin', () => {
    expect(assertSecureSiteUrl('https://studiq.app/')).toBe('https://studiq.app');
    expect(assertSecureSiteUrl('https://studiq.app:8443/')).toBe('https://studiq.app:8443');
  });

  it('rejects a path, query or fragment because return URLs are appended to it', () => {
    expect(() => assertSecureSiteUrl('https://studiq.app/app')).toThrow(/without a path/);
    expect(() => assertSecureSiteUrl('https://studiq.app/?a=1')).toThrow(/query or fragment/);
    expect(() => assertSecureSiteUrl('https://studiq.app/#x')).toThrow(/query or fragment/);
  });

  it.each([
    ['http://studiq.app', /must start with https/],
    ['https://localhost:3000', /must not point at localhost/],
    ['https://localhost.', /must not point at localhost/],
    ['https://127.0.0.1', /must not point at localhost/],
    ['https://127.0.0.2:3000', /must not point at localhost/],
    ['https://[::]', /must not point at localhost/],
    ['not-a-url', /valid absolute URL/],
    ['', /must be an https/],
  ])('rejects %s', (value, pattern) => {
    expect(() => assertSecureSiteUrl(value)).toThrow(pattern);
  });
});

describe('assertProductionSiteUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL and falls back to APP_URL', () => {
    expect(
      assertProductionSiteUrl({
        NEXT_PUBLIC_SITE_URL: 'https://studiq.app',
        APP_URL: 'http://localhost:3000',
      }),
    ).toBe('https://studiq.app');
    expect(assertProductionSiteUrl({ APP_URL: 'https://studiq.pl' })).toBe('https://studiq.pl');
  });

  it('fails when neither value is configured (the getSiteUrl fallback is localhost)', () => {
    expect(() => assertProductionSiteUrl({})).toThrow(/NEXT_PUBLIC_SITE_URL \(or APP_URL\)/);
  });
});
