import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface PlatformModule {
  nativeUnsupportedReasonFor(facts: {
    platform: string;
    arch: string;
    glibc: string | null;
    hasTar: boolean;
    uid: number | undefined;
    nativePostgresUser: string | undefined;
  }): string | null;
}

const platform = await loadEnvModule<PlatformModule>('lib/platform.ts');

const linux = {
  platform: 'linux',
  arch: 'x64',
  glibc: '2.36',
  hasTar: true,
  uid: 1000,
  nativePostgresUser: undefined,
};

describe('native platform matrix (spec §4.2)', () => {
  it('accepts Linux x86_64/arm64 with glibc >= 2.35, tar and a non-root user', () => {
    expect(platform.nativeUnsupportedReasonFor(linux)).toBeNull();
    expect(platform.nativeUnsupportedReasonFor({ ...linux, arch: 'arm64' })).toBeNull();
  });

  it('rejects old glibc, missing tar and unsupported Linux architectures', () => {
    expect(platform.nativeUnsupportedReasonFor({ ...linux, glibc: '2.34' })).toMatch(/glibc/);
    expect(platform.nativeUnsupportedReasonFor({ ...linux, glibc: null })).toMatch(/glibc/);
    expect(platform.nativeUnsupportedReasonFor({ ...linux, hasTar: false })).toMatch(/tar/);
    expect(platform.nativeUnsupportedReasonFor({ ...linux, arch: 'ia32' })).toMatch(
      /not supported/,
    );
  });

  it('allows root only with SUPABASE_NATIVE_POSTGRES_USER', () => {
    expect(platform.nativeUnsupportedReasonFor({ ...linux, uid: 0 })).toMatch(/root/);
    expect(
      platform.nativeUnsupportedReasonFor({ ...linux, uid: 0, nativePostgresUser: 'postgres' }),
    ).toBeNull();
  });

  it('accepts macOS arm64 and rejects x86_64, Windows and other platforms', () => {
    expect(
      platform.nativeUnsupportedReasonFor({ ...linux, platform: 'darwin', arch: 'arm64' }),
    ).toBeNull();
    expect(
      platform.nativeUnsupportedReasonFor({ ...linux, platform: 'darwin', arch: 'x64' }),
    ).toMatch(/Apple silicon/);
    expect(platform.nativeUnsupportedReasonFor({ ...linux, platform: 'win32' })).toMatch(/WSL2/);
    expect(platform.nativeUnsupportedReasonFor({ ...linux, platform: 'freebsd' })).toMatch(
      /not supported/,
    );
  });
});
