import { Permission, SYSTEM_ROLE_TEMPLATES, type PermissionScope } from '@studiq/authz';
import { describe, expect, it } from 'vitest';
import { type PermissionMap, resolveDashboardArea, resolveLandingArea } from '@/lib/dashboard-home';

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
    const personal: PermissionMap = {
      'deck.read': 'own',
      'flashcard.read': 'own',
      'question_bank.read': 'own',
      'quiz.read': null,
      'assignment.read': 'own',
      'stats.read': 'own',
    };
    expect(resolveDashboardArea(personal)).toBe('/app');
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
 * The landing must not resolve from an answer that is not about the caller's
 * current org: the personal map under a half-completed switch, or a payload
 * written under the outgoing org's key (design §3.4), both render a shell for an
 * org the visitor is not in. `null` means "not yet".
 */
describe('resolveLandingArea', () => {
  const admin = SYSTEM_ROLE_TEMPLATES.admin.permissions;
  const member = SYSTEM_ROLE_TEMPLATES.member.permissions;
  const orgId = '11111111-1111-4111-8111-111111111111';
  const base = { orgsPending: false, isSwitching: false, activeOrgId: orgId };

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

  it('resolves /app for a caller without an org (both ids null)', () => {
    expect(
      resolveLandingArea({
        orgsPending: false,
        isSwitching: false,
        activeOrgId: null,
        permissions: { orgId: null, permissions: member },
      }),
    ).toBe('/app');
  });
});
