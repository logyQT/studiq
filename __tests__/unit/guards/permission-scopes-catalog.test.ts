/**
 * Guard for N1 (audit §0.1): a `ctx.permissionScopes['…']` read whose key is not
 * in the closed permission catalog always resolves to `undefined`, so the check
 * silently denies every non-creator. `teacher-assignment.service.ts` shipped
 * with `assignment.read` / `assignment.update` in exactly that state, and only
 * the `assignment-permissions-seed` integration test noticed — after a stack.
 *
 * This is a source scan, not a behavioural test: it fails before the database
 * is needed. It covers the **literal** forms of both reads — an indexed
 * `permissionScopes['…']` and `resolveScope(ctx, '…')`, the function that
 * defaults a missing key to `own` for content CRUD. A key assembled at runtime
 * is out of reach of any source scan.
 *
 * `__tests__` is deliberately out of scope: fixtures index phantom keys on
 * purpose to prove a missing scope denies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Permission, PERMISSIONS } from '@studiq/authz';
import { describe, expect, it } from 'vitest';

/** `ctx.permissionScopes['assignment.read']` and `resolveScope(ctx, 'deck.read')`. */
const LITERAL_READS = [
  /permissionScopes\[\s*["']([^"']+)["']\s*\]/g,
  /resolveScope\(\s*[^,()]+,\s*["']([^"']+)["']\s*\)/g,
];

/** The code-readable set (`Permission`) and the wider closed catalog the rows carry. */
const PERMISSION_KEYS: ReadonlySet<string> = new Set(Object.values(Permission));
const CATALOG_KEYS: ReadonlySet<string> = new Set(Object.keys(PERMISSIONS));

type ScopeRead = { file: string; key: string; line: number };

function sourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      files.push(...sourceFiles(target));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(target);
  }

  return files;
}

function sourceRoots(): string[] {
  const apps = path.join(process.cwd(), 'apps');
  const roots = [path.join(process.cwd(), 'packages/server/src')];

  for (const entry of fs.readdirSync(apps, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(path.join(apps, entry.name, 'src'));
  }

  return roots.filter((directory) => fs.existsSync(directory));
}

function scopeReads(): ScopeRead[] {
  return sourceRoots()
    .flatMap(sourceFiles)
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const relative = path.relative(process.cwd(), file).split(path.sep).join('/');

      return LITERAL_READS.flatMap((pattern) =>
        [...source.matchAll(pattern)].map((match) => ({
          file: relative,
          key: match[1] ?? '',
          line: source.slice(0, match.index).split('\n').length,
        })),
      );
    });
}

describe('permission scope catalog', () => {
  it('finds the literal scope reads it guards', () => {
    const files = new Set(scopeReads().map((read) => read.file));

    expect(scopeReads().length).toBeGreaterThan(0);
    expect(files.has('packages/server/src/services/teacher-assignment.service.ts')).toBe(true);
  });

  it('every literal permission read is a closed-catalog key', () => {
    // `org_role_permissions` stores the 44-key catalog, which is wider than the
    // 26-key `Permission` set code reads; a phantom key still resolves to undefined.
    const phantom = scopeReads()
      .filter((read) => !CATALOG_KEYS.has(read.key))
      .map((read) => `${read.file}:${read.line} ${read.key}`);

    expect(
      phantom,
      'Add the key to `PERMISSIONS` in packages/authz/src/lib/permissions.ts, or fix the typo: an unknown key resolves to undefined and denies every caller.',
    ).toEqual([]);
  });

  // R15: a catalog key without a `Permission` entry is deliberate, so the set is
  // pinned instead of deleted. `org.admin` is ownership only (D16) and no route
  // gates on it through `Permission`.
  it('pins the catalog keys read outside the Permission set', () => {
    const outside = [
      ...new Set(
        scopeReads()
          .map((read) => read.key)
          .filter((key) => !PERMISSION_KEYS.has(key)),
      ),
    ].toSorted();

    expect(outside).toEqual(['org.admin']);
  });
});
