import {
  isPermissionCatalogKey,
  PERMISSIONS,
  ROLE_TEMPLATE_NAMES,
  ROLE_TEMPLATES,
  SYSTEM_ROLE_NAMES,
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
