/**
 * Migration timestamp guard: ensures no two Supabase migration files share the
 * same version prefix (the leading digits before the first `_`).
 *
 * Supabase derives the migration version from the filename, so two files like
 *   20260915000003_drop_feature_permissions.sql
 *   20260915000003_drop_plan_seat_allocations.sql
 * will cause a `schema_migrations_pkey` unique constraint violation on push.
 *
 * Wired into `bun run lint` and the pre-commit hook. Also accepts `--staged`
 * to validate only files staged in git (used by the pre-commit hook so it
 * doesn't run the full scan on every commit).
 *
 * Usage:
 *   bun scripts/check-migration-timestamps.ts          # check all migrations
 *   bun scripts/check-migration-timestamps.ts --staged  # check only staged .sql files
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
// Matches Supabase migration filenames: {timestamp}_{name}.sql
const MIGRATION_RE = /^(\d{14,})_(.+)\.sql$/;

function getMigrationFiles(): string[] {
  if (process.argv.includes('--staged')) {
    // In --staged mode, get only .sql files that are staged in git.
    // We also need ALL migration files (staged or not) to check staged ones
    // against the full set.
    const staged = execSync('git diff --cached --name-only --diff-filter=ACR', {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f.startsWith(MIGRATIONS_DIR + '/') && f.endsWith('.sql'))
      .map((f) => basename(f));

    // Return staged filenames only — we'll compare against the full directory
    // in the main check below.
    return staged;
  }

  try {
    return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch {
    console.log('✓ no migrations directory found — skipping check.');
    process.exit(0);
  }
}

function extractTimestamp(filename: string): string | null {
  const match = filename.match(MIGRATION_RE);
  return match?.[1] ?? null;
}

const stagedMode = process.argv.includes('--staged');
const allFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
const targetFiles = stagedMode ? getMigrationFiles() : allFiles;

if (targetFiles.length === 0) {
  console.log('✓ no migration files to check.');
  process.exit(0);
}

// Build timestamp → filenames map from ALL migrations on disk.
const timestampMap = new Map<string, string[]>();
for (const file of allFiles) {
  const ts = extractTimestamp(file);
  if (!ts) continue;
  const existing = timestampMap.get(ts);
  if (existing) {
    existing.push(file);
  } else {
    timestampMap.set(ts, [file]);
  }
}

// In staged mode, check only that staged files don't collide with each other
// or with existing non-staged files.
const errors: string[] = [];

if (stagedMode) {
  // Check staged files against the full map (which includes themselves).
  for (const file of targetFiles) {
    const ts = extractTimestamp(file);
    if (!ts) {
      errors.push(`  ${file}: filename does not match migration pattern {timestamp}_{name}.sql`);
      continue;
    }
    const siblings = timestampMap.get(ts) ?? [];
    if (siblings.length > 1) {
      errors.push(
        `  Timestamp ${ts} is shared by ${siblings.length} files:`,
        ...siblings.map((f) => `    - ${f}`),
      );
    }
  }
  // Deduplicate errors (a collision reports both files).
  const unique = [...new Set(errors)];
  if (unique.length > 0) {
    console.error('✖ Migration timestamp collision(s) detected in staged files:\n');
    console.error(unique.join('\n'));
    console.error(
      '\nRename one of the files with a unique timestamp prefix (e.g. YYYYMMDDHHMMSS).',
    );
    process.exit(1);
  }
} else {
  // Full scan: find any timestamp shared by more than one file.
  for (const [ts, files] of timestampMap) {
    if (files.length > 1) {
      errors.push(
        `  Timestamp ${ts} is shared by ${files.length} files:`,
        ...files.map((f) => `    - ${f}`),
      );
    }
  }
  if (errors.length > 0) {
    console.error('✖ Migration timestamp collision(s) detected:\n');
    console.error(errors.join('\n'));
    console.error(
      '\nRename one of the files with a unique timestamp prefix (e.g. YYYYMMDDHHMMSS).',
    );
    process.exit(1);
  }
}

console.log('✓ migration timestamps unique — no collisions found.');
