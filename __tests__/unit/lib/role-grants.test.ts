import { describe, expect, it } from 'vitest';
import {
  type CallerScopeMap,
  canGrant,
  grantableScopes,
  narrowestGrantable,
  rowAuthority,
  startScopeFor,
} from '@/lib/role-grants';

/**
 * The role editor's affordance (ADR-0015 §4.4/D21): a caller may offer a scope
 * only when their own scope covers it, with the `org.admin`@organization
 * exemption the server's `grantDenied` applies. `scopeCovers` is imported from
 * `@studiq/authz`, never re-implemented, so these cases pin the UI's reading of
 * the one rank table (R40).
 */
describe('grantableScopes', () => {
  it('offers every allowed scope to an organization-scope caller', () => {
    const caller: CallerScopeMap = { 'deck.read': 'organization' };

    expect(grantableScopes(caller, 'deck.read')).toEqual(['own', 'group', 'organization']);
    expect(grantableScopes(caller, 'org.member.manage')).toEqual([]);
  });

  it('offers own and group for a content key to a group-scope caller', () => {
    const caller: CallerScopeMap = { 'deck.read': 'group' };

    expect(grantableScopes(caller, 'deck.read')).toEqual(['own', 'group']);
  });

  it('offers nothing for an org key to a caller who holds it at a narrower scope', () => {
    const caller: CallerScopeMap = { 'org.member.manage': 'group' };

    expect(grantableScopes(caller, 'org.member.manage')).toEqual([]);
  });

  it('offers nothing for a key the caller does not hold', () => {
    expect(grantableScopes({}, 'deck.read')).toEqual([]);
    expect(grantableScopes({ 'flashcard.read': 'organization' }, 'deck.read')).toEqual([]);
  });

  it('answers [] for a name outside the closed catalog', () => {
    const caller: CallerScopeMap = { 'deck.read': 'organization' };

    expect(grantableScopes(caller, 'member.manage')).toEqual([]);
    expect(grantableScopes(caller, 'constructor')).toEqual([]);
  });

  it('lets an org.admin holder at organization scope grant every allowed scope', () => {
    // D21/D16: the same exemption the server applies. The key under test is one
    // the caller does not hold, so only `org.admin` can be the reason.
    const caller: CallerScopeMap = { 'org.admin': 'organization' };

    expect(grantableScopes(caller, 'org.member.manage')).toEqual(['organization']);
    expect(grantableScopes(caller, 'group.invite')).toEqual(['group', 'organization']);
  });

  it('does not exempt an org.admin row held at a narrower scope', () => {
    const caller: CallerScopeMap = { 'org.admin': 'group' };

    expect(grantableScopes(caller, 'org.member.manage')).toEqual([]);
  });

  it('offers nothing for the non-assignable ownership key', () => {
    // D16: `org.admin` is never assignable, not even to an org.admin holder —
    // the server answers 422, so the editor must not offer the row either.
    expect(grantableScopes({ 'org.admin': 'organization' }, 'org.admin')).toEqual([]);
    expect(grantableScopes({}, 'org.admin')).toEqual([]);
  });
});

describe('startScopeFor', () => {
  it('starts a new grant at the narrowest grantable scope, not the widest', () => {
    // `group.invite` declares `group | organization`, so the narrowest grantable
    // is `group`; a content key starts at `own` even for an organization holder.
    expect(startScopeFor({ 'group.invite': 'group' }, 'group.invite')).toBe('group');
    expect(startScopeFor({ 'deck.read': 'organization' }, 'deck.read')).toBe('own');
  });

  it('falls back to the catalog order only when the caller may grant none', () => {
    expect(startScopeFor({}, 'deck.read')).toBe('own');
  });
});

describe('rowAuthority', () => {
  it('disables a key the caller cannot grant', () => {
    const caller: CallerScopeMap = { 'deck.read': 'organization' };

    expect(rowAuthority(caller, 'org.member.manage', null)).toMatchObject({
      grantable: [],
      toggleDisabled: true,
    });
    expect(rowAuthority(caller, 'deck.read', null)).toMatchObject({ toggleDisabled: false });
  });

  it('keeps a stored grant beyond the caller authority visible but non-editable', () => {
    const caller: CallerScopeMap = { 'deck.read': 'own' };

    expect(rowAuthority(caller, 'deck.read', 'organization')).toMatchObject({
      canEditCurrent: false,
      toggleDisabled: true,
    });
  });

  it('locks ownership and leaves an unresolved map to the server', () => {
    expect(rowAuthority({ 'org.admin': 'organization' }, 'org.admin', null)).toMatchObject({
      locked: true,
      toggleDisabled: true,
    });
    expect(rowAuthority(undefined, 'org.member.manage', null)).toEqual({
      grantable: null,
      locked: false,
      canEditCurrent: true,
      toggleDisabled: false,
    });
  });
});

describe('narrowestGrantable', () => {
  it('returns the narrowest scope the caller may grant, not the first allowed one', () => {
    // `group.invite` declares `group | organization`, so a group-scope caller may
    // grant `group` only. A content key starts at `own` for any caller.
    expect(narrowestGrantable({ 'group.invite': 'group' }, 'group.invite')).toBe('group');
    expect(narrowestGrantable({ 'deck.read': 'organization' }, 'deck.read')).toBe('own');
  });

  it('returns null when the caller may grant none', () => {
    expect(narrowestGrantable({}, 'deck.read')).toBeNull();
    expect(narrowestGrantable({ 'deck.read': 'own' }, 'org.member.manage')).toBeNull();
  });
});

describe('canGrant', () => {
  it('answers one scope test against the same filter', () => {
    const caller: CallerScopeMap = { 'deck.read': 'group' };

    expect(canGrant(caller, 'deck.read', 'own')).toBe(true);
    expect(canGrant(caller, 'deck.read', 'group')).toBe(true);
    expect(canGrant(caller, 'deck.read', 'organization')).toBe(false);
  });

  it('answers false for an unknown key', () => {
    const caller: CallerScopeMap = { 'deck.read': 'organization' };

    expect(canGrant(caller, 'member.manage', 'own')).toBe(false);
  });

  it('treats a null scope in the map as not held', () => {
    const caller: CallerScopeMap = { 'deck.read': 'organization', 'flashcard.read': null };

    expect(grantableScopes(caller, 'flashcard.read')).toEqual([]);
    expect(canGrant(caller, 'flashcard.read', 'own')).toBe(false);
  });
});
