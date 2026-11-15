#!/usr/bin/env bun
/**
 * PR triage: reviewable size and size bucket.
 *
 * The size budget counts production/reviewable lines only. Test files, Markdown
 * docs, generated files, the lockfile and vendored agent skills are excluded —
 * they are still reported, so a large test suite or a long design doc is visible
 * without spending the budget that decides whether the code is small enough to
 * review in one pass.
 *
 * A PR over the budget is not automatically wrong, but it must be split or
 * carry the `size:exception` label once `PR_SIZE_ENFORCE=true`.
 *
 * Usage:
 *   bun scripts/pr-triage.ts                 # human summary vs origin/main
 *   bun scripts/pr-triage.ts --json          # machine output (pr-triage.yml, scripts/pr)
 *   bun scripts/pr-triage.ts --base main     # explicit base ref
 *   bun scripts/pr-triage.ts --limit 300     # override the 400-line budget
 *   bun scripts/pr-triage.ts --enforce       # exit 1 when over the budget
 *
 * `--base` and `--limit` require a value (`--base VALUE`, `--limit VALUE`);
 * a missing value exits 2 instead of silently falling back to a default.
 */

import { spawnSync } from 'node:child_process';

type SizeBucket = 'XS' | 'S' | 'M' | 'L' | 'XL';

interface TriageLabel {
  name: string;
  color: string;
  description: string;
}

interface DiffEntry {
  path: string;
  added: number;
  deleted: number;
}

interface TriageResult {
  base: string;
  limit: number;
  total: number;
  testLines: number;
  docLines: number;
  excludedLines: number;
  changedFiles: number;
  bucket: SizeBucket;
  label: TriageLabel;
  overLimit: boolean;
}

const DEFAULT_BASE = 'origin/main';
const DEFAULT_LIMIT = 400;

const LABEL_COLORS: Record<SizeBucket, string> = {
  XS: '0e8a16',
  S: '1d76db',
  M: 'fbca04',
  L: 'd93f0b',
  XL: 'b60205',
};

// Excluded from the budget, but their lines are reported separately. Markdown
// is prose, not production code.
const TEST_PATHS = [/^__tests__\//, /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/];
const DOC_PATHS = [/\.mdx?$/];
const EXCLUDED_PATHS = [
  /^bun\.lock$/,
  /^eslint-suppressions\.json$/,
  /^skills-lock\.json$/,
  /^packages\/server\/src\/types\/database\.ts$/,
  /^\.agents\/skills\//,
];

class OptionError extends Error {}

// A flag without a value is an error, not an implicit default: `--limit`
// followed by another flag or nothing at all is almost always a scripting bug.
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new OptionError(`${name} requires a value`);
  }

  return value;
}

function parseLimit(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new OptionError('--limit must be a positive integer');
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OptionError('--limit must be a positive integer');
  }

  return value;
}

function parseNumstat(output: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const tokens = output.split('\0');

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;

    const [addedField = '0', deletedField = '0', pathField = ''] = token.split('\t');
    let path = pathField;

    // Renames are written as `<added>\t<deleted>\t\0<old>\0<new>\0`: the path
    // field is empty and the next two tokens carry the paths.
    if (path === '') {
      const newPath = tokens[index + 2];
      if (tokens[index + 1] === undefined || newPath === undefined) continue;
      path = newPath;
      index += 2;
    }

    entries.push({
      path,
      added: addedField === '-' ? 0 : Number(addedField),
      deleted: deletedField === '-' ? 0 : Number(deletedField),
    });
  }

  return entries;
}

function bucketFor(total: number, limit: number): SizeBucket {
  // Check the budget first so an over-budget PR is never labelled below XL,
  // even when the limit is tighter than the absolute S/M boundary.
  if (total > limit) return 'XL';
  if (total <= 10) return 'XS';
  if (total <= 50) return 'S';
  if (total <= 200) return 'M';
  return 'L';
}

function labelFor(bucket: SizeBucket, limit: number): TriageLabel {
  const descriptions: Record<SizeBucket, string> = {
    XS: '10 or fewer reviewable lines',
    S: 'Within the review budget',
    M: 'Within the review budget',
    L: `At the ${limit}-line review budget`,
    XL: `Over the ${limit}-line review budget`,
  };

  return {
    name: `size/${bucket}`,
    color: LABEL_COLORS[bucket],
    description: descriptions[bucket],
  };
}

function triage(base: string, limit: number): TriageResult {
  const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) {
    throw new Error(`base ref '${base}' not found; fetch it first (e.g. git fetch origin main)`);
  }

  const diff = spawnSync('git', ['diff', '--numstat', '-M', '-z', `${base}...HEAD`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (diff.status !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim() || `exit ${diff.status}`}`);
  }

  const entries = parseNumstat(diff.stdout);
  let total = 0;
  let testLines = 0;
  let docLines = 0;
  let excludedLines = 0;

  for (const entry of entries) {
    const lines = entry.added + entry.deleted;
    if (TEST_PATHS.some((pattern) => pattern.test(entry.path))) {
      testLines += lines;
    } else if (EXCLUDED_PATHS.some((pattern) => pattern.test(entry.path))) {
      excludedLines += lines;
    } else if (DOC_PATHS.some((pattern) => pattern.test(entry.path))) {
      docLines += lines;
    } else {
      total += lines;
    }
  }

  const overLimit = total > limit;
  const bucket = bucketFor(total, limit);

  return {
    base,
    limit,
    total,
    testLines,
    docLines,
    excludedLines,
    changedFiles: entries.length,
    bucket,
    label: labelFor(bucket, limit),
    overLimit,
  };
}

function main(): void {
  const json = process.argv.includes('--json');
  const enforce = process.argv.includes('--enforce');

  let base: string;
  let limit: number;
  try {
    base = option('--base') ?? DEFAULT_BASE;
    const rawLimit = option('--limit');
    limit = rawLimit === undefined ? DEFAULT_LIMIT : parseLimit(rawLimit);
  } catch (error) {
    console.error(`pr-triage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  let result: TriageResult;
  try {
    result = triage(base, limit);
  } catch (error) {
    console.error(`pr-triage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `PR size vs ${result.base}: ${result.total}/${result.limit} reviewable lines (${result.bucket})`,
    );
    console.log(
      `  excluded: ${result.testLines} test, ${result.docLines} doc, ${result.excludedLines} generated/vendored line(s)`,
    );
  }

  if (enforce && result.overLimit) {
    process.exitCode = 1;
  }
}

// Importable for tests without running the CLI.
if (import.meta.main) {
  main();
}
