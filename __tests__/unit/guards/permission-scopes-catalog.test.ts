/**
 * Guard for N1 (audit §0.1): a `ctx.permissionScopes['…']` read whose key is not
 * in the `Permission` catalog always resolves to `undefined`, so the check
 * silently denies every non-creator. `teacher-assignment.service.ts` shipped
 * with `assignment.read` / `assignment.update` in exactly that state, and only
 * the `assignment-permissions-seed` integration test noticed — after a stack.
 *
 * This is a source scan, not a behavioural test: it fails before the database
 * is needed. Keys are compared with `Object.values(Permission)`, so the catalog
 * in `@studiq/authz` stays the single place a new key is declared.
 *
 * `__tests__` is deliberately out of scope: fixtures index phantom keys on
 * purpose to prove a missing scope denies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Permission } from '@studiq/authz';
import { describe, expect, it } from 'vitest';

/** `ctx.permissionScopes['assignment.read']` — the literal key only. */
const SCOPE_READ = /permissionScopes\[\s*'([^']+)'\s*\]/g;

const PERMISSION_KEYS: ReadonlySet<string> = new Set(Object.values(Permission));

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

      return [...source.matchAll(SCOPE_READ)].map((match) => ({
        file: relative,
        key: match[1] ?? '',
        line: source.slice(0, match.index).split('\n').length,
      }));
    });
}

describe('permission scope catalog', () => {
  it('finds the scope reads it guards', () => {
    expect(scopeReads().length).toBeGreaterThan(0);
  });

  it('every permissionScopes literal is a Permission catalog key', () => {
    const phantom = scopeReads()
      .filter((read) => !PERMISSION_KEYS.has(read.key))
      .map((read) => `${read.file}:${read.line} ${read.key}`);

    expect(
      phantom,
      'Add the key to `Permission` in packages/authz/src/lib/permissions.ts (and to the permissions catalog), or fix the typo: an unknown key resolves to undefined and denies every caller.',
    ).toEqual([]);
  });
});
