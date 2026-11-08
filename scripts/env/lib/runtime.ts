import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import type { StackStatus } from './stack';

/**
 * Platform hint for the native runtime. The Supabase CLI is authoritative; this
 * exists so `env:doctor` can explain an actionable failure. Linux amd64/arm64
 * and macOS arm64 only (Windows via WSL2).
 */
export function nativeRuntimeSupported(): boolean {
  if (!commandExists('tar')) return false;
  const { platform, arch } = process;
  if (platform === 'linux') return arch === 'x64' || arch === 'arm64';
  if (platform === 'darwin') return arch === 'arm64';
  return false;
}

function commandExists(name: string): boolean {
  const searchPath = process.env.PATH ?? '';
  for (const dir of searchPath.split(':')) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

function dockerAvailable(): boolean {
  if (!commandExists('docker')) return false;
  return spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
}

function podmanAvailable(): boolean {
  if (!commandExists('podman')) return false;
  return spawnSync('podman', ['info'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
}

export function runtimeAvailable(runtime: string): boolean {
  if (runtime === 'native') return nativeRuntimeSupported();
  if (runtime === 'docker') return dockerAvailable();
  if (runtime === 'podman') return podmanAvailable();
  return false;
}

export interface RuntimeResolution {
  configured: string;
  persisted: string | null;
  effective: string;
}

/**
 * Ported from `scripts/dev`'s `effective_supabase_runtime`: an explicit
 * non-`auto` choice wins; otherwise the running/persisted stack runtime;
 * otherwise the pre-spike Docker default (`auto` probes Docker → Podman →
 * native).
 */
export function resolveRuntime(
  stack: StackStatus | null,
  listedRuntime: string | null,
): RuntimeResolution {
  const configured = process.env.SUPABASE_RUNTIME ?? '';
  const persisted = stack?.runtime || listedRuntime || null;

  if (configured && configured !== 'auto') {
    return { configured, persisted, effective: configured };
  }
  if (persisted) return { configured, persisted, effective: persisted };
  if (!configured) return { configured, persisted, effective: 'docker' };
  if (dockerAvailable()) return { configured, persisted, effective: 'docker' };
  if (podmanAvailable()) return { configured, persisted, effective: 'podman' };
  return { configured, persisted, effective: 'native' };
}
