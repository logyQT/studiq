import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CONFLICT, EXIT_USAGE, EnvFailure } from './exit';
import { type ProfileName } from '../profiles';
import { REPO_ROOT } from './repo';
import { readSeedMarker } from './state';
import type { SeedMode } from '../atoms';

/**
 * Tenant seeding boundary (spec §7).
 *
 * Phase 2 owns the **marker** contract — `(stackId, hash(seed scripts))` in
 * `.dev/seed/`, mode 600 — and the safety rules (never a shared/foreign stack,
 * `--no-seed` wins, `--reseed` forces). No phase-2 profile has a tenant seeder:
 * `api`/`web` are "no" in §3 and the QA/e2e seeders are phase 3 (their
 * fixtures are per-run and must never be marker-gated). `--seed` therefore
 * fails loudly instead of pretending to have seeded.
 */
const SEED_FILES = [
  'scripts/qa-tenant.ts',
  'scripts/e2e-seed.ts',
  'scripts/seed/cli.ts',
  'scripts/seed/qa.ts',
  'scripts/seed/e2e.ts',
] as const;

/** Hash every seed script's contents (sorted for determinism). */
function seedScriptsHash(root = REPO_ROOT): string {
  const hash = createHash('sha256');
  const files = [...SEED_FILES].sort();
  for (const file of files) {
    hash.update(file).update('\0');
    try {
      const path = join(root, file);
      if (statSync(path).isFile()) hash.update(readFileSync(path));
    } catch {
      hash.update('missing');
    }
    hash.update('\0');
  }
  // New files under `scripts/seed/` must also invalidate the marker.
  try {
    for (const name of readdirSync(join(root, 'scripts', 'seed')).sort()) {
      if (!name.endsWith('.ts')) continue;
      const relative = `scripts/seed/${name}`;
      if ((SEED_FILES as ReadonlyArray<string>).includes(relative)) continue;
      hash.update(relative).update('\0');
      try {
        hash.update(readFileSync(join(root, relative)));
      } catch {
        hash.update('missing');
      }
      hash.update('\0');
    }
  } catch {
    hash.update('no-seed-dir');
  }
  return hash.digest('hex');
}

export function seedMarkerCurrent(stackId: string, root = REPO_ROOT): boolean {
  const marker = readSeedMarker(stackId);
  return (
    marker !== null && marker.stackId === stackId && marker.scriptsHash === seedScriptsHash(root)
  );
}

/**
 * The seeder that owns a profile. `null` means "no seeder exists in this
 * phase"; phase 3 adds the qa/e2e run-scoped invocation.
 */
function seederForProfile(profile: ProfileName): null {
  switch (profile) {
    case 'api':
    case 'web':
      return null;
    case 'db':
    case 'mail':
    case 'full':
    case 'admin':
    case 'qa':
    case 'e2e':
      return null;
  }
}

export function assertSeedingAllowed(options: {
  mode: SeedMode;
  profile: ProfileName;
  shared: boolean;
}): void {
  const requested = options.mode === 'seed' || options.mode === 'reseed';
  if (!requested) return;
  if (options.shared) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      'SUPABASE_SHARED=1: refusing to seed a stack this checkout does not own',
    );
  }
  if (seederForProfile(options.profile) === null) {
    throw new EnvFailure(
      EXIT_USAGE,
      [
        `profile '${options.profile}' has no tenant seeder in phase 2.`,
        'Cold stack creation already applies migrations + supabase/seeds.',
        'Tenant seeding (qa/e2e, run-scoped) lands in phase 3; --no-seed is accepted.',
      ].join('\n'),
    );
  }
}
