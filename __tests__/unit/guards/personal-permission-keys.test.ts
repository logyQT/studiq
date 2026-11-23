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

function family(key: string): string {
  return key.slice(0, key.indexOf('.'));
}

function verb(key: string): string {
  return key.slice(key.indexOf('.') + 1);
}

/**
 * Every `content` CRUD key of the five personal families, plus `stats.read`.
 * `quiz.*` and `assignment.*` are content CRUD too and fall out on the family
 * filter; a new content family falls out until it is added here or to the set.
 */
function expectedPersonalKeys(): string[] {
  const keys = Object.entries(PERMISSIONS)
    .filter(
      ([key, definition]) =>
        definition.category === 'content' &&
        PERSONAL_FAMILIES.has(family(key)) &&
        CRUD_VERBS.has(verb(key)),
    )
    .map(([key]) => key);

  keys.push('stats.read');
  return keys.toSorted();
}

/** The set's members as `string`, the type a request action arrives as. */
const MEMBERS: ReadonlySet<string> = PERSONAL_PERMISSION_KEYS;

describe('PERSONAL_PERMISSION_KEYS', () => {
  it('is exactly the five content families CRUD plus stats.read', () => {
    expect([...PERSONAL_PERMISSION_KEYS].toSorted()).toEqual(expectedPersonalKeys());
  });

  // Their services refuse a no-org call (quizzes and teacher assignments are
  // org rows), so a personal scope for them could only authorize a failure.
  it('leaves every quiz and assignment key out', () => {
    const excluded = Object.keys(PERMISSIONS).filter((key) =>
      ['quiz', 'assignment'].includes(family(key)),
    );

    expect(excluded.length).toBeGreaterThan(0);
    for (const key of excluded) {
      expect(MEMBERS.has(key)).toBe(false);
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
