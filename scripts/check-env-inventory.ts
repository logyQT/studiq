#!/usr/bin/env bun
/**
 * Env-inventory guard, wired into `bun run lint` (see package.json).
 *
 * Three rules, all additive to the existing gates:
 *
 * 1. Every **static** `process.env.<KEY>` reference in the app, package, script
 *    and test scopes must be declared in the root `.env.schema`. Dynamic access
 *    (`process.env[name]`, destructuring) is deliberately not statically
 *    resolvable and is skipped — those keys are still expected to be declared,
 *    which is why the schema also carries the names the tooling reads through
 *    helpers (`scripts/dev`, `scripts/load-test/config.ts`, the seeders).
 * 2. No root `.env` values file may exist. The root file is the operator's
 *    hand-edited local state and must never be committed or required by a gate.
 * 3. No generated values file may live under `apps/<app>/` or `supabase/`
 *    (`.env`, `.env.local`, `.env.*.local`). Tracked templates (`*.example`) and
 *    the schema itself are not values files.
 *
 * The ambient allowlist below is for OS/execution-environment names only. It is
 * intentionally tiny: anything owned by this repository belongs in the schema.
 *
 * Usage: `bun scripts/check-env-inventory.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCHEMA_FILE = '.env.schema';
const CODE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Code scopes that may read app configuration. */
const CODE_ROOTS = ['apps/web/src', 'apps/admin/src', 'packages', 'scripts', '__tests__'];

/**
 * OS-provided names. These describe *where/how the process runs*, not app
 * configuration, so they are never part of the inventory. Keep this list to
 * names the operating system or shell owns.
 */
const AMBIENT_ALLOWLIST = new Set(['PATH', 'HOME', 'LANG', 'LC_ALL']);

/** Values-file names that must not exist under `apps/*` or `supabase/`. */
const VALUES_FILE_NAMES = new Set(['.env', '.env.local']);
const LOCAL_VALUES_FILE_RE = /^\.env\..+\.local$/;

const PROCESS_ENV_RE = /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (isDirectory(full)) {
      yield* walk(full);
    } else if (isFile(full) && CODE_EXT.test(entry)) {
      yield full;
    }
  }
}

/** Root-level `*.ts` / `*.tsx` configs (vitest, playwright, knip, …). */
function rootCodeFiles(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => entry.name);
}

/** Declared keys from `.env.schema` (`KEY=`, never `KEY=value`). */
function declaredKeys(): Set<string> {
  const raw = readFileSync(SCHEMA_FILE, 'utf8');
  const keys = new Set<string>();
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

/** Static `process.env.<KEY>` references, grouped by file. */
function staticReferences(): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();
  const files: string[] = rootCodeFiles();

  for (const root of CODE_ROOTS) {
    if (!isDirectory(root)) continue;
    if (root === 'packages') {
      for (const entry of readdirSync(root)) {
        const src = join(root, entry, 'src');
        if (isDirectory(src)) files.push(...walk(src));
      }
      continue;
    }
    files.push(...walk(root));
  }

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(PROCESS_ENV_RE)) {
      const key = match[1];
      if (!key) continue;
      const seen = references.get(file) ?? new Set<string>();
      seen.add(key);
      references.set(file, seen);
    }
  }
  return references;
}

const declared = declaredKeys();
const violations: string[] = [];

// Rule 1 — undeclared static references.
const references = staticReferences();
const referenced = new Set<string>();
for (const keys of references.values()) for (const key of keys) referenced.add(key);
for (const [file, keys] of [...references.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const missing = [...keys].filter((key) => !declared.has(key) && !AMBIENT_ALLOWLIST.has(key));
  for (const key of missing.sort()) {
    violations.push(
      `${relative(ROOT, file)} reads process.env.${key}, which is not declared in ${SCHEMA_FILE}`,
    );
  }
}

// Rule 2 — the root values file must not exist.
if (isFile('.env')) {
  violations.push('./.env exists — the root values file must stay untracked and unrequired by CI');
}

// Rule 3 — no generated/git-ignored values files from the app or Supabase dirs.
function checkValuesFiles(dir: string): void {
  if (!isDirectory(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (
      isFile(join(dir, entry)) &&
      (VALUES_FILE_NAMES.has(entry) || LOCAL_VALUES_FILE_RE.test(entry))
    ) {
      violations.push(`${join(dir, entry)} is a values file — keep values out of the checkout`);
    }
  }
}

if (isDirectory('apps')) {
  for (const entry of readdirSync('apps')) checkValuesFiles(join('apps', entry));
}
checkValuesFiles('supabase');

if (violations.length > 0) {
  console.error(`\n  x env inventory check failed (${violations.length} violation(s)):\n`);
  for (const violation of violations) console.error(`    - ${violation}`);
  console.error(
    `\n    Declare the key in ${SCHEMA_FILE} (value-free) or remove the reference.\n` +
      '    Ambient OS names are allowlisted in scripts/check-env-inventory.ts only.\n',
  );
  process.exit(1);
}

console.log(
  `✓ env inventory: ${declared.size} keys declared, ${referenced.size} static reference(s) across the code scopes, no stray values files.`,
);
