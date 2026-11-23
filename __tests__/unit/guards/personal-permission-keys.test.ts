/**
 * Guard for D35 (register row 3): with no active org the personal default is a
 * fixed key set, not a persona rule. The expected set is derived from the
 * permission catalog, so a content key added there fails this guard until
 * someone classifies it as personal or org-only.
 */

import {
  isPersonalPermissionKey,
  PERMISSIONS,
  Permission,
  PERSONAL_PERMISSION_KEYS,
} from '@studiq/authz';
import { describe, expect, it } from 'vitest';

/** The five resource families where a caller's own rows are a real personal surface. */
const PERSONAL_FAMILIES: ReadonlySet<string> = new Set([
  'deck',
  'flashcard',
  'topic',
  'question',
  'question_bank',
]);

/** The CRUD verbs a personal content key carries. */
const CRUD_VERBS: ReadonlySet<string> = new Set(['read', 'create', 'update', 'delete']);

/**
 * The assignment verbs a personal (`organization_id` NULL) row supports. `create`
 * needs an active org (`teacher-assignment.service.ts`), and `publish`/`grade`
 * sit on an org cohort the legacy persona default never granted.
 */
const PERSONAL_ASSIGNMENT_KEYS: ReadonlySet<string> = new Set([
  'assignment.read',
  'assignment.update',
  'assignment.delete',
]);

function family(key: string): string {
  return key.slice(0, key.indexOf('.'));
}

function verb(key: string): string {
  return key.slice(key.indexOf('.') + 1);
}

/** Every member of the catalog's `content` category. */
function contentKeys(): string[] {
  return Object.entries(PERMISSIONS)
    .filter(([, definition]) => definition.category === 'content')
    .map(([key]) => key)
    .toSorted();
}

/**
 * The five personal families' CRUD keys plus the assignment verbs a personal
 * row supports, plus `stats.read` — 24 in all. A key that has to be personal
 * but is matched by neither arm stays out until it is classified.
 */
function expectedPersonalKeys(): string[] {
  const keys = contentKeys().filter(
    (key) =>
      PERSONAL_ASSIGNMENT_KEYS.has(key) ||
      (PERSONAL_FAMILIES.has(family(key)) && CRUD_VERBS.has(verb(key))),
  );

  keys.push('stats.read');
  return keys.toSorted();
}

/** The set's members as `string`, the type a request action arrives as. */
const MEMBERS: ReadonlySet<string> = PERSONAL_PERMISSION_KEYS;

describe('PERSONAL_PERMISSION_KEYS', () => {
  it('is exactly the five content families CRUD, the personal assignment verbs and stats.read', () => {
    const expected = expectedPersonalKeys();

    expect(expected).toHaveLength(24);
    expect([...PERSONAL_PERMISSION_KEYS].toSorted()).toEqual(expected);
  });

  // The complement is a decision, not an omission: every content key outside
  // the set is named here, so a new family or verb fails until it is placed.
  it('leaves exactly the org-only content keys out', () => {
    const complement = contentKeys().filter((key) => !MEMBERS.has(key));

    expect(complement).toEqual([
      'assignment.create',
      'assignment.grade',
      'assignment.publish',
      'quiz.create',
      'quiz.delete',
      'quiz.read',
      'quiz.update',
    ]);
    for (const key of complement) {
      expect(isPersonalPermissionKey(key)).toBe(false);
    }
  });

  it('names only real Permission keys', () => {
    const permissionKeys: ReadonlySet<string> = new Set(Object.values(Permission));

    for (const key of PERSONAL_PERMISSION_KEYS) {
      expect(permissionKeys.has(key)).toBe(true);
      expect(isPersonalPermissionKey(key)).toBe(true);
    }
    expect(isPersonalPermissionKey('legacy.read')).toBe(false);
  });
});
