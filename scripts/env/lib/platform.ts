import { spawnSync } from 'node:child_process';
import { UsageError, type RuntimeChoice } from '../atoms';
import { EXIT_NATIVE_UNAVAILABLE, EnvFailure } from './exit';

/**
 * Runtime policy (spec §4).
 *
 * Native is the default and the only runtime this tool ever selects on its own.
 * Docker exists only as an explicit escape hatch; Podman is not supported and
 * there is no fallback. The CLI performs the authoritative platform check —
 * this one exists so an unsupported host fails with the exact opt-in command.
 */
export interface RuntimeSelection {
  runtime: RuntimeChoice;
  /** True when a flag or `SUPABASE_RUNTIME` selected it, rather than the default. */
  explicit: boolean;
}

function glibcVersion(): string | null {
  const getconf = spawnSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8', timeout: 5_000 });
  const text = `${getconf.stdout ?? ''} ${getconf.stderr ?? ''}`;
  const match = /glibc\s+([0-9]+)\.([0-9]+)/i.exec(text);
  return match ? `${match[1]}.${match[2]}` : null;
}

function hasTar(): boolean {
  const result = spawnSync('tar', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  return result.status === 0;
}

/** `null` when native can run here; otherwise a short human reason. */
export interface PlatformFacts {
  platform: NodeJS.Platform;
  arch: string;
  glibc: string | null;
  hasTar: boolean;
  uid: number | undefined;
  nativePostgresUser: string | undefined;
}

/** @public Exercised by the unit tests, which load this module by computed URL. */
export function nativeUnsupportedReasonFor(facts: PlatformFacts): string | null {
  if (facts.platform === 'linux') {
    if (facts.arch !== 'x64' && facts.arch !== 'arm64') {
      return `Linux ${facts.arch} is not supported (needs x86_64 or arm64)`;
    }
    if (!facts.glibc) return 'glibc was not detected (native needs glibc >= 2.35)';
    const [major, minor] = facts.glibc.split('.').map(Number) as [number, number];
    if (major < 2 || (major === 2 && minor < 35)) {
      return `glibc ${facts.glibc} is too old (native needs >= 2.35)`;
    }
    if (!facts.hasTar) return 'tar is not available';
    if (facts.uid === 0 && !facts.nativePostgresUser) {
      return 'running as root (set SUPABASE_NATIVE_POSTGRES_USER to a non-root account)';
    }
    return null;
  }

  if (facts.platform === 'darwin') {
    if (facts.arch === 'arm64') return null;
    return 'macOS x86_64 is not supported (needs Apple silicon)';
  }

  if (facts.platform === 'win32') return 'native Windows is unsupported; use WSL2';
  return `${facts.platform} ${facts.arch} is not supported`;
}

function nativeUnsupportedReason(): string | null {
  return nativeUnsupportedReasonFor({
    platform: process.platform,
    arch: process.arch,
    glibc: process.platform === 'linux' ? glibcVersion() : null,
    hasTar: hasTar(),
    uid: process.getuid?.(),
    nativePostgresUser: process.env.SUPABASE_NATIVE_POSTGRES_USER,
  });
}

export function assertNativeAvailable(profile: string): void {
  const reason = nativeUnsupportedReason();
  if (!reason) return;
  throw new EnvFailure(
    EXIT_NATIVE_UNAVAILABLE,
    [
      `native runtime is unavailable on this platform (${reason}).`,
      'Docker is the explicit escape hatch:',
      `  SUPABASE_RUNTIME=docker bun run env:ensure --profile ${profile}`,
      `  bun run env:ensure --profile ${profile} --runtime docker`,
    ].join('\n'),
  );
}

/** Resolve the selected runtime; `null` flag means "flag absent". */
export function selectRuntime(flag: RuntimeChoice | null): RuntimeSelection {
  if (flag) return { runtime: flag, explicit: true };

  const env = (process.env.SUPABASE_RUNTIME ?? '').trim().toLowerCase();
  if (env === '' || env === 'auto') return { runtime: 'native', explicit: false };
  if (env === 'native' || env === 'docker') return { runtime: env, explicit: true };
  if (env === 'podman') {
    throw new UsageError('SUPABASE_RUNTIME=podman is not supported; use native or docker');
  }
  throw new UsageError(`SUPABASE_RUNTIME='${env}' is not valid (expected native or docker)`);
}
