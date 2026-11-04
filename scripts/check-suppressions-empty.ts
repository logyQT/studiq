#!/usr/bin/env bun
/**
 * Suppression-ledger guard, wired into `bun run lint` (see package.json).
 *
 * `eslint-suppressions.json` is a burn-down ledger, not a place to park debt.
 * After #984 the ledger is empty: every finding is either fixed or carries a
 * justified inline `eslint-disable` with a reason. A non-empty ledger means
 * someone ran `bun lint --suppress-all` instead of fixing the finding, which
 * hides new violations because the file records a per-file, per-rule *count*.
 *
 * Keep this check narrow on purpose: it does not ban inline disables (some are
 * correct at genuinely untyped boundaries), it only stops the ledger from
 * silently refilling.
 *
 * Usage: `bun scripts/check-suppressions-empty.ts`
 */
import { readFileSync } from 'node:fs';

const LEDGER = 'eslint-suppressions.json';

let raw: string;
try {
  raw = readFileSync(LEDGER, 'utf8');
} catch (error) {
  // Only a missing ledger is equivalent to an empty one. Permissions, a
  // directory in its place, or any other I/O error must fail the check.
  if (isErrnoException(error) && error.code === 'ENOENT') process.exit(0);
  throw error;
}

function isErrnoException(error: unknown): error is { code?: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(`\n  x ${LEDGER} is not valid JSON.\n`);
  process.exit(1);
}

const isEmpty =
  parsed !== null &&
  typeof parsed === 'object' &&
  !Array.isArray(parsed) &&
  Object.keys(parsed).length === 0;

if (!isEmpty) {
  console.error(
    `\n  x ${LEDGER} is not empty.\n` +
      `    Fix the finding, or add an inline eslint-disable with a reason.\n` +
      `    Re-baselining hides new violations: the ledger is count-based per file+rule.\n`,
  );
  process.exit(1);
}

console.log('✓ suppression ledger is empty');
