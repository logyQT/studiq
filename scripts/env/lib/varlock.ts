import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './repo';

/**
 * Structured, sanitized varlock metadata for `env:verify`.
 *
 * varlock is the only loader/validator. This module runs `varlock load` with
 * `--format json-full` (which includes every schema item, present or not) and
 * keeps **names and presence only** — the resolved values are read to build the
 * object and then dropped. Nothing here is ever printed: `env:verify` reports
 * missing key names and provider status, never varlock's output (which is only
 * prefix-redacted).
 */
export interface VarlockItem {
  present: boolean;
  sensitive: boolean;
}

export interface VarlockResult {
  ok: boolean;
  exitCode: number | null;
  items: Map<string, VarlockItem>;
  /** `locked`/`missing` classification; null when the load succeeded. */
  failure: 'locked' | 'missing' | null;
}

interface RawItem {
  value?: unknown;
  isSensitive?: unknown;
}

function classify(stderr: string): 'locked' | 'missing' {
  const text = stderr.toLowerCase();
  if (
    /locked|lock(ed|ing)?\b|biometric|keychain|unlock|denied|unauthorized|forbidden|auth(entication)? required/.test(
      text,
    )
  ) {
    return 'locked';
  }
  return 'missing';
}

/**
 * `paths: null` runs the checkout's default entry point (`.env.schema` +
 * `.env.local`). `--full` passes `[vault, '.']` so the checkout wins on a
 * duplicate key; a missing `--path` is a hard varlock error, so callers only
 * pass the vault when it exists.
 */
export function loadVarlock(options: {
  paths: string[] | null;
  root?: string;
  timeoutMs?: number;
}): VarlockResult {
  const args = ['varlock', 'load', '--format', 'json-full', '--include-internal'];
  for (const path of options.paths ?? []) args.push('--path', path);
  const result = spawnSync('bunx', args, {
    cwd: options.root ?? REPO_ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  const exitCode = timedOut ? null : result.status;
  const ok = !timedOut && result.status === 0;
  const items = new Map<string, VarlockItem>();

  if (result.stdout) {
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const config = (parsed as { config?: unknown }).config;
        if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
          for (const [key, value] of Object.entries(config)) {
            if (value === null || typeof value !== 'object') continue;
            const item = value as RawItem;
            items.set(key, {
              present: Object.hasOwn(item, 'value') && item.value !== undefined,
              sensitive: item.isSensitive === true,
            });
          }
        }
      }
    } catch {
      // A non-JSON workload (or a truncated banner) is reported through the exit
      // code; never echo stdout.
    }
  }

  return {
    ok,
    exitCode,
    items,
    failure: ok ? null : classify(result.stderr ?? ''),
  };
}
