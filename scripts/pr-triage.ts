#!/usr/bin/env bun
/**
 * PR triage: reviewable size, size bucket and deep-review routing.
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
 */

import { spawnSync } from 'node:child_process';

type SizeBucket = 'XS' | 'S' | 'M' | 'L' | 'XL';

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
  overLimit: boolean;
  sensitive: boolean;
  deepReview: boolean;
}

const DEFAULT_BASE = 'origin/main';
const DEFAULT_LIMIT = 400;

// Excluded from the budget, but their lines are reported separately. Markdown
// is prose, not production code; contract and decision docs stay sensitive below.
const TEST_PATHS = [/^__tests__\//, /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/];
const DOC_PATHS = [/\.mdx?$/];
const EXCLUDED_PATHS = [
  /^bun\.lock$/,
  /^eslint-suppressions\.json$/,
  /^skills-lock\.json$/,
  /^packages\/server\/src\/types\/database\.ts$/,
  /^\.agents\/skills\//,
];

// Small-but-risky PRs get a deep review even under the budget. These are the
// places where an LLM reviewer earns its keep: auth, tenancy, money, CI.
const SENSITIVE_PATHS = [
  /^packages\/server\/src\/lib\/(?:authz|with-auth|supabase)/,
  /^packages\/server\/src\/config\/routes\.config\.ts$/,
  /^apps\/web\/src\/proxy\.ts$/,
  /^supabase\/(?:migrations|schemas)\//,
  /^packages\/server\/src\/services\/.*(?:stripe|billing|subscription)/,
  /^apps\/admin\//,
  /^\.github\/workflows\//,
  /^scripts\/check-.*\.ts$/,
  // Docs are excluded from the size budget, but the contract and decision
  // records are exactly the prose that deserves a second pair of eyes.
  /^AGENTS\.md$/,
  /^docs\/decisions\//,
];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
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
  if (total <= 10) return 'XS';
  if (total <= 50) return 'S';
  if (total <= 200) return 'M';
  if (total <= limit) return 'L';
  return 'XL';
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
  const sensitive = entries.some((entry) =>
    SENSITIVE_PATHS.some((pattern) => pattern.test(entry.path)),
  );

  return {
    base,
    limit,
    total,
    testLines,
    docLines,
    excludedLines,
    changedFiles: entries.length,
    bucket: bucketFor(total, limit),
    overLimit,
    sensitive,
    deepReview: overLimit || sensitive,
  };
}

function main(): void {
  const json = process.argv.includes('--json');
  const enforce = process.argv.includes('--enforce');
  const base = option('--base') ?? DEFAULT_BASE;
  const rawLimit = option('--limit');
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number.parseInt(rawLimit, 10);

  if (!Number.isInteger(limit) || limit <= 0) {
    console.error('pr-triage: --limit must be a positive integer');
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
    console.log(`  sensitive paths: ${result.sensitive ? 'yes' : 'no'}`);
    console.log(`  deep review: ${result.deepReview ? 'yes' : 'no'}`);
  }

  if (enforce && result.overLimit) {
    process.exitCode = 1;
  }
}

// Importable for tests without running the CLI.
if (import.meta.main) {
  main();
}
