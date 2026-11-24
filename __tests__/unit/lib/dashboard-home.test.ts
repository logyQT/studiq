import {
  Permission,
  PERSONAL_PERMISSION_KEYS,
  ROLE_TEMPLATES,
  SYSTEM_ROLE_TEMPLATES,
  type PermissionScope,
} from '@studiq/authz';
import { describe, expect, it } from 'vitest';
import {
  hasAreaAccess,
  type PermissionMap,
  resolveDashboardArea,
  resolveLandingArea,
} from '@/lib/dashboard-home';

/**
 * The 24-key personal set 6c resolves for a caller without an org. Derived from
 * the catalog so a key that is classified personal there is exercised here too.
 */
function personalPermissions(): PermissionMap {
  const map: PermissionMap = {};
  for (const key of PERSONAL_PERMISSION_KEYS) map[key] = 'own';
  return map;
}

/**
 * The area a caller lands on is a function of the **active org's permissions**
 * (ADR-0015 §7.1, R40). The seeded role maps come from the real templates, so a
 * template that gained or lost a key without this resolver following would fail
 * here rather than send the wrong persona to the wrong shell.
 */
describe('resolveDashboardArea', () => {
  it('sends the seeded Admin role to /manage', () => {
    expect(resolveDashboardArea(SYSTEM_ROLE_TEMPLATES.admin.permissions)).toBe('/manage');
  });

  it('sends the seeded Teacher role to /edu', () => {
    expect(resolveDashboardArea(SYSTEM_ROLE_TEMPLATES.teacher.permissions)).toBe('/edu');
  });

  it('sends the seeded Member role to /app', () => {
    expect(resolveDashboardArea(SYSTEM_ROLE_TEMPLATES.member.permissions)).toBe('/app');
  });

  it('sends a caller without an org (the personal content set) to /app', () => {
    // 6c: outside an org every caller resolves the personal content keys at
    // `own` — no `org.*`, no `group.*`, so the personal shell is the answer.
    expect(resolveDashboardArea(personalPermissions())).toBe('/app');
  });

  it('sends a custom role holding a single org.* key to /manage', () => {
    // Not the role's name and not its profile: the key is the authority.
    const custom: PermissionMap = { [Permission.ORG_REPORT_MANAGE]: 'organization' };
    expect(resolveDashboardArea(custom)).toBe('/manage');
  });

  it.each([
    Permission.ORG_SETTINGS_MANAGE,
    Permission.ORG_MEMBER_MANAGE,
    Permission.ORG_INVITATION_MANAGE,
    Permission.ORG_ROLE_MANAGE,
    Permission.ORG_SEAT_MANAGE,
    Permission.ORG_BILLING_MANAGE,
    Permission.ORG_REPORT_MANAGE,
    Permission.ORG_AUDIT_READ,
    Permission.ORG_ADMIN,
  ])('%s alone is enough for /manage', (key) => {
    expect(resolveDashboardArea({ [key]: 'organization' })).toBe('/manage');
  });

  it.each([Permission.GROUP_MANAGE, Permission.GROUP_INVITE, Permission.GROUP_MEMBER_MANAGE])(
    '%s alone is enough for /edu (and never /manage)',
    (key) => {
      expect(resolveDashboardArea({ [key]: 'group' })).toBe('/edu');
    },
  );

  it('prefers /manage when a role holds both families', () => {
    const both: PermissionMap = {
      [Permission.GROUP_MANAGE]: 'group',
      [Permission.ORG_MEMBER_MANAGE]: 'organization',
    };
    expect(resolveDashboardArea(both)).toBe('/manage');
  });

  it('never treats a higher scope as a different area', () => {
    // Presence only: an area entry has no resource row, so `own` and
    // `organization` answer the same question (`SidebarGates.permission`).
    const scopes: PermissionScope[] = ['own', 'group', 'organization'];
    for (const scope of scopes) {
      expect(resolveDashboardArea({ [Permission.ORG_SEAT_MANAGE]: scope })).toBe('/manage');
    }
  });

  it('falls back to /app for an absent, empty or unresolved map', () => {
    expect(resolveDashboardArea(undefined)).toBe('/app');
    expect(resolveDashboardArea({})).toBe('/app');
    expect(resolveDashboardArea({ [Permission.ORG_MEMBER_MANAGE]: null })).toBe('/app');
  });
});

/**
 * The area gate's predicate is deliberately broader than the landing's: `/edu`
 * also counts every content read, because that is where those surfaces live and a
 * Member holds them. The seeded role maps come from the real templates, so a
 * template that gained or lost a key without this predicate following would fail
 * here.
 */
describe('hasAreaAccess', () => {
  it('opens both areas to the seeded Admin role', () => {
    expect(hasAreaAccess(SYSTEM_ROLE_TEMPLATES.admin.permissions, '/manage')).toBe(true);
    expect(hasAreaAccess(SYSTEM_ROLE_TEMPLATES.admin.permissions, '/edu')).toBe(true);
  });

  it('opens /edu and not /manage to the seeded Teacher role', () => {
    expect(hasAreaAccess(SYSTEM_ROLE_TEMPLATES.teacher.permissions, '/edu')).toBe(true);
    expect(hasAreaAccess(SYSTEM_ROLE_TEMPLATES.teacher.permissions, '/manage')).toBe(false);
  });

  it('opens /edu and not /manage to the seeded Member role', () => {
    // The Member holds no class-management key, but it does hold the content
    // reads, and `/edu` is their area — the landing still sends it to `/app`.
    const member = SYSTEM_ROLE_TEMPLATES.member.permissions;
    expect(hasAreaAccess(member, '/edu')).toBe(true);
    expect(hasAreaAccess(member, '/manage')).toBe(false);

    // The content-read arm is what opens the area, not the `group.read` the
    // member also holds: with only the reads, the gate must still admit it.
    const contentOnly = Object.fromEntries(
      Object.entries(member).filter(([key]) => key.endsWith('.read') && !key.startsWith('group.')),
    );
    expect(contentOnly).toHaveProperty('deck.read');
    expect(contentOnly).not.toHaveProperty('group.read');
    expect(hasAreaAccess(contentOnly, '/edu'), 'content reads alone').toBe(true);
  });

  it('opens /manage and not /edu to a Billing preset holder', () => {
    // `org.billing.manage` + `org.seat.manage`, no content read and no group key:
    // the exact shape that separates "manages something" from "uses /edu".
    const billing = ROLE_TEMPLATES.billing.permissions;
    expect(hasAreaAccess(billing, '/manage')).toBe(true);
    expect(hasAreaAccess(billing, '/edu')).toBe(false);
  });

  it('closes both areas to an empty or unresolved map', () => {
    expect(hasAreaAccess({}, '/manage')).toBe(false);
    expect(hasAreaAccess({}, '/edu')).toBe(false);
    expect(hasAreaAccess(undefined, '/manage')).toBe(false);
    expect(hasAreaAccess(undefined, '/edu')).toBe(false);
  });

  it('counts a content read as /edu access and never as /manage', () => {
    for (const key of [
      Permission.DECK_READ,
      Permission.QUESTION_BANK_READ,
      Permission.ASSIGNMENT_READ,
      Permission.STATS_READ,
      Permission.QUIZ_READ,
    ]) {
      expect(hasAreaAccess({ [key]: 'own' }, '/edu'), `${key} → /edu`).toBe(true);
      expect(hasAreaAccess({ [key]: 'own' }, '/manage'), `${key} → /manage`).toBe(false);
    }
  });

  it('counts a class key as /edu access and an org key as /manage access', () => {
    expect(hasAreaAccess({ [Permission.GROUP_READ]: 'group' }, '/edu')).toBe(true);
    expect(hasAreaAccess({ [Permission.GROUP_READ]: 'group' }, '/manage')).toBe(false);
    expect(hasAreaAccess({ [Permission.ORG_AUDIT_READ]: 'organization' }, '/manage')).toBe(true);
    expect(hasAreaAccess({ [Permission.ORG_AUDIT_READ]: 'organization' }, '/edu')).toBe(false);
  });
});

/**
 * The landing answers onboarding first, then the permission-derived area, and
 * `null` while it cannot answer. The first-run branch matters because 6c gives a
 * caller without an org the personal keys: without it a first-run manager or
 * educator would resolve `/app` and the declared `/setup*` exception would be
 * unreachable from `/login`.
 */
describe('resolveLandingArea', () => {
  const admin = SYSTEM_ROLE_TEMPLATES.admin.permissions;
  const member = SYSTEM_ROLE_TEMPLATES.member.permissions;
  const orgId = '11111111-1111-4111-8111-111111111111';
  const base = {
    orgsCount: 1,
    orgsPending: false,
    orgsFetching: false,
    isSwitching: false,
    activeOrgId: orgId,
    accountType: 'manager',
  };

  it('waits for the org list, the auto-selection and the map', () => {
    expect(
      resolveLandingArea({
        ...base,
        orgsPending: true,
        permissions: { orgId, permissions: admin },
      }),
    ).toBeNull();
    expect(
      resolveLandingArea({
        ...base,
        isSwitching: true,
        permissions: { orgId, permissions: admin },
      }),
    ).toBeNull();
    expect(resolveLandingArea({ ...base, permissions: undefined })).toBeNull();
  });

  it('waits for the first-org auto-selection instead of reading the personal map', () => {
    // The membership list has settled but no org is active yet: the `null` map
    // would answer `/app`, which is not where `useOrgs` is about to switch.
    expect(
      resolveLandingArea({
        ...base,
        activeOrgId: null,
        permissions: { orgId: null, permissions: personalPermissions() },
      }),
    ).toBeNull();
  });

  it('waits for a map that names a different org than the active one', () => {
    // The personal answer while the first-org switch is in flight.
    expect(
      resolveLandingArea({ ...base, permissions: { orgId: null, permissions: member } }),
    ).toBeNull();
    // A stale payload for the org the caller just left.
    expect(
      resolveLandingArea({
        ...base,
        permissions: { orgId: '22222222-2222-4222-8222-222222222222', permissions: admin },
      }),
    ).toBeNull();
  });

  it('resolves the area once the map describes the active org', () => {
    expect(resolveLandingArea({ ...base, permissions: { orgId, permissions: admin } })).toBe(
      '/manage',
    );
    expect(
      resolveLandingArea({
        ...base,
        permissions: { orgId, permissions: SYSTEM_ROLE_TEMPLATES.teacher.permissions },
      }),
    ).toBe('/edu');
    expect(resolveLandingArea({ ...base, permissions: { orgId, permissions: member } })).toBe(
      '/app',
    );
  });

  it('resolves /app for a learner without an org (both ids null)', () => {
    expect(
      resolveLandingArea({
        orgsCount: 0,
        orgsPending: false,
        orgsFetching: false,
        isSwitching: false,
        activeOrgId: null,
        accountType: 'student',
        permissions: { orgId: null, permissions: personalPermissions() },
      }),
    ).toBe('/app');
  });

  describe('a first run (settled, zero orgs)', () => {
    const firstRun = {
      orgsCount: 0,
      orgsPending: false,
      orgsFetching: false,
      isSwitching: false,
      activeOrgId: null,
    };

    it('sends a manager to /setup/org before the permission answer exists', () => {
      expect(resolveLandingArea({ ...firstRun, accountType: 'manager' })).toBe('/setup/org');
    });

    it('sends an educator to the /setup chooser', () => {
      expect(resolveLandingArea({ ...firstRun, accountType: 'educator' })).toBe('/setup');
    });

    it('keeps the personal set from winning over onboarding', () => {
      // 6c's 24 personal keys would otherwise make this a `/app` landing.
      expect(
        resolveLandingArea({
          ...firstRun,
          accountType: 'manager',
          permissions: { orgId: null, permissions: personalPermissions() },
        }),
      ).toBe('/setup/org');
      expect(
        resolveLandingArea({
          ...firstRun,
          accountType: 'educator',
          permissions: { orgId: null, permissions: personalPermissions() },
        }),
      ).toBe('/setup');
    });

    it('waits while the org list is still settling', () => {
      expect(
        resolveLandingArea({ ...firstRun, accountType: 'manager', orgsPending: true }),
      ).toBeNull();
      expect(
        resolveLandingArea({ ...firstRun, accountType: 'manager', orgsFetching: true }),
      ).toBeNull();
    });
  });
});
