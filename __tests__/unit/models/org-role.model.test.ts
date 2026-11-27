import { PERMISSIONS, ROLE_TEMPLATE_NAMES } from '@studiq/authz';
import {
  CATALOG_PERMISSION_KEYS,
  CreateOrgRoleSchema,
  SetRolePermissionsSchema,
  UpdateOrgRoleSchema,
} from '@studiq/server/models/org-role.model';
import { describe, expect, it } from 'vitest';

/** A body the editor sends: one entry per catalog key, the listed ones granted. */
function payload(granted: Record<string, 'own' | 'group' | 'organization' | null> = {}) {
  return {
    permissions: CATALOG_PERMISSION_KEYS.map((key) => ({
      permissionName: key,
      scope: granted[key] ?? null,
    })),
  };
}

/** The catalog keys a failed parse names in its issue paths. */
function issueKeys(result: ReturnType<typeof SetRolePermissionsSchema.safeParse>): string[] {
  if (result.success) return [];
  return result.error.issues.flatMap((issue) =>
    issue.path.filter((part): part is string => typeof part === 'string'),
  );
}

describe('SetRolePermissionsSchema', () => {
  it('accepts the complete catalog with a scope or a null revoke per key', () => {
    const result = SetRolePermissionsSchema.safeParse(
      payload({
        'flashcard.read': 'own',
        'deck.read': 'group',
        'org.member.manage': 'organization',
      }),
    );

    expect(result.success).toBe(true);
  });

  it('accepts a complete all-null payload as "this role holds nothing"', () => {
    const result = SetRolePermissionsSchema.safeParse(payload());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.permissions).toHaveLength(CATALOG_PERMISSION_KEYS.length);
    expect(result.data.permissions.every((entry) => entry.scope === null)).toBe(true);
  });

  it('rejects a permission name outside the closed catalog', () => {
    const body = payload();
    const result = SetRolePermissionsSchema.safeParse({
      permissions: [
        ...body.permissions,
        { permissionName: 'member.manage', scope: 'organization' },
      ],
    });

    expect(result.success).toBe(false);
    expect(issueKeys(result)).toContain('member.manage');
  });

  it('rejects a duplicate key and names it', () => {
    const body = payload({ 'flashcard.read': 'own' });
    const result = SetRolePermissionsSchema.safeParse({
      permissions: [...body.permissions, { permissionName: 'flashcard.read', scope: 'group' }],
    });

    expect(result.success).toBe(false);
    expect(issueKeys(result)).toContain('flashcard.read');
  });

  it('rejects a name that only exists on the object prototype', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const body = payload();
      const result = SetRolePermissionsSchema.safeParse({
        permissions: [...body.permissions, { permissionName: name, scope: null }],
      });

      expect(result.success, `${name} must not pass as a catalog key`).toBe(false);
      expect(issueKeys(result)).toContain(name);
    }
  });

  it('names every missing catalog key', () => {
    const result = SetRolePermissionsSchema.safeParse({
      permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
    });

    expect(result.success).toBe(false);
    const named = issueKeys(result);
    expect(named).toContain('org.member.manage');
    expect(named).toContain('stats.read');
    expect(named).not.toContain('flashcard.read');
  });

  it('rejects a scope the key does not allow', () => {
    // `group.invite` is group | organization only; `org.member.manage` is organization only.
    const invite = SetRolePermissionsSchema.safeParse(payload({ 'group.invite': 'own' }));
    const orgKey = SetRolePermissionsSchema.safeParse(payload({ 'org.member.manage': 'group' }));

    expect(invite.success).toBe(false);
    expect(issueKeys(invite)).toContain('scope');
    expect(orgKey.success).toBe(false);
    expect(issueKeys(orgKey)).toContain('scope');
  });

  it('refuses a group grant on a content write (#961)', () => {
    const groupWrite = SetRolePermissionsSchema.safeParse(payload({ 'deck.update': 'group' }));

    expect(groupWrite.success).toBe(false);
    if (groupWrite.success) throw new Error('unreachable');
    expect(groupWrite.error.issues).toContainEqual(
      expect.objectContaining({
        path: ['permissions', CATALOG_PERMISSION_KEYS.indexOf('deck.update'), 'scope'],
      }),
    );

    // The positive control: the same payload at an allowed scope passes, so the
    // refusal above cannot come from the payload's shape.
    expect(SetRolePermissionsSchema.safeParse(payload({ 'deck.update': 'own' })).success).toBe(
      true,
    );
  });

  it('accepts every allowed scope of every key', () => {
    for (const key of CATALOG_PERMISSION_KEYS) {
      for (const scope of PERMISSIONS[key].allowedScopes) {
        const result = SetRolePermissionsSchema.safeParse(payload({ [key]: scope }));
        expect(result.success, `${key} at ${scope}`).toBe(true);
      }
    }
  });

  it('rejects an unknown scope value', () => {
    const body = payload();
    const result = SetRolePermissionsSchema.safeParse({
      permissions: body.permissions.map((entry) =>
        entry.permissionName === 'flashcard.read' ? { ...entry, scope: 'any' } : entry,
      ),
    });

    expect(result.success).toBe(false);
  });

  it('carries an optional, nullable entitlement profile in the same payload', () => {
    expect(SetRolePermissionsSchema.safeParse(payload()).success).toBe(true);
    expect(
      SetRolePermissionsSchema.safeParse({ ...payload(), entitlementProfile: null }).success,
    ).toBe(true);
    const withProfile = SetRolePermissionsSchema.safeParse({
      ...payload(),
      entitlementProfile: 'learner',
    });
    expect(withProfile.success).toBe(true);
    if (!withProfile.success) throw new Error('unreachable');
    expect(withProfile.data.entitlementProfile).toBe('learner');
  });

  it('rejects an unknown entitlement profile', () => {
    const result = SetRolePermissionsSchema.safeParse({
      ...payload(),
      entitlementProfile: 'everything',
    });

    expect(result.success).toBe(false);
  });
});

describe('org role schemas — entitlement profile', () => {
  it('accepts a known profile and rejects an unknown one on create', () => {
    expect(
      CreateOrgRoleSchema.safeParse({ name: 'Assistant', entitlementProfile: 'learner' }).success,
    ).toBe(true);
    expect(
      CreateOrgRoleSchema.safeParse({ name: 'Assistant', entitlementProfile: 'everything' })
        .success,
    ).toBe(false);
  });

  it('accepts a known profile and rejects an unknown one on update', () => {
    expect(UpdateOrgRoleSchema.safeParse({ entitlementProfile: 'all' }).success).toBe(true);
    expect(UpdateOrgRoleSchema.safeParse({ entitlementProfile: 'everything' }).success).toBe(false);
  });
});

describe('org role schemas — templates (D17)', () => {
  it('accepts every editor preset and the blank default', () => {
    for (const template of ROLE_TEMPLATE_NAMES) {
      expect(CreateOrgRoleSchema.safeParse({ name: 'Assistant', template }).success, template).toBe(
        true,
      );
    }
    expect(CreateOrgRoleSchema.safeParse({ name: 'Assistant' }).success).toBe(true);
  });

  it('rejects a template outside the closed preset list', () => {
    const result = CreateOrgRoleSchema.safeParse({ name: 'Assistant', template: 'teacher' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['template']);
  });

  it('does not offer a template on update: the field is stripped, not honoured', () => {
    const parsed = UpdateOrgRoleSchema.safeParse({ template: 'assistant' });

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('template');
  });
});
