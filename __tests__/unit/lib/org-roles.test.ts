import {
  isPermissionCatalogKey,
  PERMISSIONS,
  ROLE_TEMPLATE_NAMES,
  ROLE_TEMPLATES,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_TEMPLATES,
  type PermissionCatalogKey,
} from '@studiq/authz';
import { describe, expect, it } from 'vitest';

/**
 * Editor presets (ADR-0015 §4.2/§9, D17). A preset is materialised as an
 * ordinary custom role, so it must stay inside the closed catalog the role
 * editor writes: a key the editor cannot render would be a row the org can
 * never repair from the UI (the 2a-3 follow-up note), and `org.admin` would
 * make a preset an ownership grant (D16).
 *
 * These are shape invariants, not a copy of the constant: the expected sets are
 * derived from `PERMISSIONS`, and the DB matrix equality lives in
 * `__tests__/integration/org-role-templates.test.ts`.
 */

const TEMPLATE_ENTRIES = Object.entries(ROLE_TEMPLATES);

function keysOf(scopeName: 'content' | 'group' | 'org'): PermissionCatalogKey[] {
  return Object.entries(PERMISSIONS)
    .filter(([, definition]) => definition.category === scopeName)
    .map(([key]) => key)
    .filter(isPermissionCatalogKey);
}

describe('SYSTEM_ROLE_TEMPLATES', () => {
  it('admin grants every catalog key at organization scope', () => {
    expect(SYSTEM_ROLE_TEMPLATES.admin.permissions).toEqual(
      Object.fromEntries(
        Object.keys(PERMISSIONS)
          .filter(isPermissionCatalogKey)
          .map((key) => [key, 'organization']),
      ),
    );
  });

  it('teacher reads content at group and writes it at own (D29)', () => {
    const expected = {
      ...Object.fromEntries(
        keysOf('content').map((key) => [key, key.endsWith('.read') ? 'group' : 'own']),
      ),
      ...Object.fromEntries(keysOf('group').map((key) => [key, 'group'])),
    };

    expect(SYSTEM_ROLE_TEMPLATES.teacher.permissions).toEqual(expected);
    // The keys D29 names explicitly: read moves, every write verb stays own.
    expect(SYSTEM_ROLE_TEMPLATES.teacher.permissions['assignment.read']).toBe('group');
    expect(SYSTEM_ROLE_TEMPLATES.teacher.permissions['stats.read']).toBe('group');
    expect(SYSTEM_ROLE_TEMPLATES.teacher.permissions['assignment.publish']).toBe('own');
    expect(SYSTEM_ROLE_TEMPLATES.teacher.permissions['assignment.grade']).toBe('own');
  });

  it('member reads the learner family at group, keeps stats.read at own', () => {
    const expected = {
      ...Object.fromEntries(
        keysOf('content')
          .filter((key) => !key.startsWith('assignment.'))
          .map((key) => [
            key,
            key === 'stats.read' ? 'own' : key.endsWith('.read') ? 'group' : 'own',
          ]),
      ),
      'group.read': 'group',
    };

    expect(SYSTEM_ROLE_TEMPLATES.member.permissions).toEqual(expected);
  });
});

describe('ROLE_TEMPLATES', () => {
  it('declares exactly the names the request schema accepts', () => {
    expect(Object.keys(ROLE_TEMPLATES).toSorted()).toEqual([...ROLE_TEMPLATE_NAMES].toSorted());
  });

  it('is never one of the three seeded system roles', () => {
    for (const name of ROLE_TEMPLATE_NAMES) {
      expect(SYSTEM_ROLE_NAMES as readonly string[], name).not.toContain(name);
    }
  });

  it('keeps every key inside the closed catalog at a scope the key allows', () => {
    for (const [name, template] of TEMPLATE_ENTRIES) {
      for (const [key, scope] of Object.entries(template.permissions)) {
        if (!isPermissionCatalogKey(key)) {
          throw new Error(`${name} names a key the closed catalog does not know: ${key}`);
        }
        expect(PERMISSIONS[key].allowedScopes, `${name} grants ${key} at ${scope}`).toContain(
          scope,
        );
      }
    }
  });

  it('never grants ownership (D16)', () => {
    for (const [name, template] of TEMPLATE_ENTRIES) {
      expect(Object.keys(template.permissions), name).not.toContain('org.admin');
    }
  });

  it('grants no paid entitlement surface: every preset is the `none` profile', () => {
    for (const [name, template] of TEMPLATE_ENTRIES) {
      expect(template.entitlementProfile, name).toBe('none');
    }
  });

  it('assistant = front-desk org keys + every content key at organization scope', () => {
    expect(ROLE_TEMPLATES.assistant.permissions).toEqual({
      'org.member.manage': 'organization',
      'org.invitation.manage': 'organization',
      'org.report.manage': 'organization',
      ...Object.fromEntries(keysOf('content').map((key) => [key, 'organization'])),
    });
  });

  it('billing = the plan and seat keys only', () => {
    expect(ROLE_TEMPLATES.billing.permissions).toEqual({
      'org.billing.manage': 'organization',
      'org.seat.manage': 'organization',
    });
  });

  it('read-only = every content/group read key + the audit log, at organization scope', () => {
    const readKeys = [...keysOf('content'), ...keysOf('group')].filter((key) =>
      key.endsWith('.read'),
    );

    expect(ROLE_TEMPLATES['read-only'].permissions).toEqual(
      Object.fromEntries([...readKeys, 'org.audit.read'].map((key) => [key, 'organization'])),
    );
  });

  it('blank grants nothing', () => {
    expect(ROLE_TEMPLATES.blank.permissions).toEqual({});
  });
});

/**
 * #961: a group share is a view share. These eleven content writes cannot hold
 * `group`, because the product offers no edit share. `organization` stays: it is
 * the Admin role's deliberate org-wide authority, not sharing.
 */
const CONTENT_WRITE_KEYS = [
  'deck.update',
  'deck.delete',
  'flashcard.create',
  'flashcard.update',
  'flashcard.delete',
  'question.update',
  'question.delete',
  'question_bank.update',
  'question_bank.delete',
  'topic.update',
  'topic.delete',
] as const;

describe('content writes and the group scope (#961)', () => {
  it('the eleven content writes do not allow group', () => {
    for (const key of CONTENT_WRITE_KEYS) {
      expect(PERMISSIONS[key].allowedScopes, key).toEqual(['own', 'organization']);
    }
  });

  it('the keys that keep group still allow it', () => {
    const keepsGroup: PermissionCatalogKey[] = [
      'deck.read',
      'flashcard.read',
      'topic.read',
      'question.read',
      'question_bank.read',
      'deck.create',
      'topic.create',
      'question.create',
      'question_bank.create',
      'quiz.update',
      'assignment.update',
      'stats.read',
      'group.manage',
    ];
    for (const key of keepsGroup) {
      expect(PERMISSIONS[key].allowedScopes, key).toContain('group');
    }
  });
});

/**
 * `allowedScopes` is declared narrowest → widest (ADR-0015 §4.1). The role
 * editor and `grantableScopes` read `[0]` as "the narrowest scope this key
 * accepts", so the order is load-bearing, not cosmetic — a swapped pair would
 * turn a new grant into the widest scope by declaration luck (phase 6d).
 */
describe('PERMISSIONS.allowedScopes ordering', () => {
  const RANK = { own: 0, group: 1, organization: 2 } as const;

  it('lists every key narrowest to widest', () => {
    for (const [key, definition] of Object.entries(PERMISSIONS)) {
      const ranks = definition.allowedScopes.map((scope) => RANK[scope]);
      const sorted = [...ranks].toSorted((a, b) => a - b);

      expect(ranks, `${key} must be ordered narrowest → widest`).toEqual(sorted);
    }
  });
});
