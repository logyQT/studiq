import { AccountType, type RequestContext } from '@studiq/authz';
import {
  emptySeal,
  heldNotice,
  isWindowOpen,
  sealedIdFilter,
  sealFor,
  type Seal,
} from '@studiq/server/lib/question-seal';
import { describe, expect, it } from 'vitest';

// The pure half of the derived reservation (#1171, R2/R14): the window bounds, the held notice
// and the exclusion filter. The database derivation is covered by `item-seal.test.ts`.

function ctx(accountType: AccountType): RequestContext {
  return {
    userId: 'student-1',
    accountType,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
}

function seal(entries: Array<[string, string | null, string | null]>): Seal {
  const value = emptySeal();
  for (const [id, bankId, closesAt] of entries) {
    value.ids.add(id);
    value.bankId.set(id, bankId);
    value.closesAt.set(id, closesAt);
  }
  return value;
}

describe('derived item reservation', () => {
  const now = new Date('2026-11-14T12:00:00Z');

  it('opens the window at start and closes it at the deadline', () => {
    const window = { start_time: '2026-11-14T11:00:00Z', deadline: '2026-11-14T13:00:00Z' };
    expect(isWindowOpen(window, now)).toBe(true);
    expect(isWindowOpen(window, new Date('2026-11-14T10:59:59Z')), 'before the start').toBe(false);
    expect(isWindowOpen(window, new Date('2026-11-14T13:00:00Z')), 'at the close').toBe(false);
  });

  it('treats a missing bound as open, which the publish gate refuses from this release', () => {
    expect(isWindowOpen({}, now)).toBe(true);
    expect(isWindowOpen({ start_time: null, deadline: null }, now)).toBe(true);
    expect(isWindowOpen({ deadline: '2026-11-14T11:00:00Z' }, now)).toBe(false);
  });

  it('counts only the bank’s held items and reports the latest close', () => {
    const notice = heldNotice(
      seal([
        ['q-1', 'bank-1', '2026-11-15T10:00:00Z'],
        ['q-2', 'bank-1', '2026-11-16T10:00:00Z'],
        ['q-3', 'bank-2', '2026-11-30T10:00:00Z'],
      ]),
      'bank-1',
    );
    expect(notice).toEqual({ heldCount: 2, heldUntil: '2026-11-16T10:00:00Z' });
  });

  it('reports no date when a held item has no dated release', () => {
    const notice = heldNotice(seal([['q-1', 'bank-1', null]]), 'bank-1');
    expect(notice).toEqual({ heldCount: 1, heldUntil: null });
  });

  it('reports nothing for a bank with no held item', () => {
    expect(heldNotice(seal([['q-1', 'bank-2', '2026-11-15T10:00:00Z']]), 'bank-1')).toEqual({
      heldCount: 0,
      heldUntil: null,
    });
  });

  it('hands the query an exclusion list, and nothing when the set is empty', () => {
    expect(sealedIdFilter(emptySeal())).toBeNull();
    expect(sealedIdFilter(seal([['q-1', 'bank-1', null]]))).toBe('(q-1)');
  });

  it('gives staff an empty seal without touching the database', async () => {
    const staff = await sealFor(ctx(AccountType.EDUCATOR));
    expect(staff.success).toBe(true);
    if (staff.success) expect(staff.data.ids.size).toBe(0);
  });
});
