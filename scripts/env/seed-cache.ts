#!/usr/bin/env bun
/**
 * Seed a worktree's `.next/cache` from the published snapshot (ADR-0014).
 *
 * `scripts/spin` calls this after `bun install`; it is also the way to seed a
 * checkout by hand. It is deliberately not an `env` command: the snapshot has no
 * producer subcommand (a no-op `env build` refreshes it), and this is the read
 * side only.
 *
 * Usage: `bun scripts/env/seed-cache.ts [--json] [<worktree>]`
 *
 * Exit codes: 0 seeded, skipped or disabled; 2 bad usage; 6 a refused cache root.
 * A skipped seed is normal — a mismatched identity, a worktree that already has a
 * cache and a full disk all leave the build cold.
 */
import { resolve } from 'node:path';
import { seedWorktreeCache } from './lib/build-cache';
import { EXIT_CONFLICT, EXIT_USAGE, EnvFailure } from './lib/exit';
import { printJson, writeLine, writeStderrLine } from './lib/output';

const USAGE = `Usage: bun scripts/env/seed-cache.ts [--json] [<worktree>]

Seeds <worktree>/apps/web/.next/cache from the published Turbopack snapshot.
The seed is skipped when the snapshot does not match this checkout, the cache
already exists, or free space is short; STUDIQ_CACHE_SEED=0 disables it.`;

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(argv: string[]): Promise<number> {
  let json = false;
  let target = '';
  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      writeLine(USAGE);
      return 0;
    }
    if (arg.startsWith('-')) throw new EnvFailure(EXIT_USAGE, `unknown option '${arg}'`);
    if (target !== '') throw new EnvFailure(EXIT_USAGE, 'one worktree path only');
    target = arg;
  }

  if ((process.env['STUDIQ_CACHE_SEED'] ?? '1') === '0') {
    if (json) printJson({ status: 'skipped', reason: 'STUDIQ_CACHE_SEED=0' });
    else writeLine('seed: skipped (STUDIQ_CACHE_SEED=0)');
    return 0;
  }

  const result = await seedWorktreeCache({
    worktreeRoot: target === '' ? process.cwd() : resolve(target),
  });
  if (json) printJson(result);
  else if (result.status === 'seeded') {
    writeLine(
      `seed: seeded ${result.id} (${result.fileCount} files, ${megabytes(result.sizeBytes)})`,
    );
  } else if (result.status === 'skipped') {
    writeLine(`seed: skipped: ${result.reason}`);
  } else {
    writeStderrLine(`env: cache seed refused: ${result.reason}`);
  }
  return result.status === 'refused' ? EXIT_CONFLICT : 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof EnvFailure) {
    writeStderrLine(`env: ${error.message}`);
    process.exitCode = error.exitCode;
  } else {
    writeStderrLine(`env: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
