import { describe, expect, it } from 'vitest';
import { type CheckoutOrg, type OrgsStatus, resolveCheckoutOrg } from '@/lib/checkout-org';

const ORG_A = '00000000-0000-4000-8000-000000000001';
const ORG_B = '00000000-0000-4000-8000-000000000002';

/**
 * A row as the old contract typed it: the fixture still carries the role *name*
 * so these cases can say what the rule must ignore. The production type has no
 * such field — the checkout keys on `canBill` (design §2.3).
 */
type FixtureOrg = CheckoutOrg & { orgRoleName?: string };

function org(overrides: Partial<FixtureOrg> & { id: string }): FixtureOrg {
  return {
    name: `Org ${overrides.id.slice(-1)}`,
    canBill: true,
    orgRoleName: 'admin',
    isActive: false,
    ...overrides,
  };
}

const activeA: FixtureOrg[] = [
  org({ id: ORG_A, name: 'WSB Merito', isActive: true }),
  org({ id: ORG_B, name: 'UE Wrocław' }),
];

function resolve(input: {
  isOrgPlan?: boolean;
  orgId?: string | null;
  orgs?: readonly FixtureOrg[];
  orgsStatus?: OrgsStatus;
}) {
  return resolveCheckoutOrg({
    isOrgPlan: input.isOrgPlan ?? true,
    orgId: input.orgId === undefined ? ORG_A : input.orgId,
    orgs: input.orgs ?? activeA,
    orgsStatus: input.orgsStatus ?? 'ready',
  });
}

describe('resolveCheckoutOrg', () => {
  it('ignores a stray org_id on a personal plan', () => {
    expect(resolve({ isOrgPlan: false })).toEqual({ status: 'not-org-plan' });
  });

  it('blocks an org plan without org_id, even before the orgs load', () => {
    expect(resolve({ orgId: null, orgs: undefined, orgsStatus: 'pending' })).toEqual({
      status: 'missing-org-id',
    });
  });

  it('treats a blank org_id as missing', () => {
    expect(resolve({ orgId: '   ' })).toEqual({ status: 'missing-org-id' });
    expect(resolve({ orgId: '' })).toEqual({ status: 'missing-org-id' });
  });

  it('reports loading while the membership list is pending', () => {
    expect(resolve({ orgs: undefined, orgsStatus: 'pending' })).toEqual({ status: 'loading' });
  });

  it('reports a load error before looking at the org', () => {
    expect(resolve({ orgs: undefined, orgsStatus: 'error' })).toEqual({ status: 'load-error' });
  });

  it('resolves the selected org when its role can bill', () => {
    expect(resolve({})).toEqual({
      status: 'ok',
      org: activeA[0],
      isDifferentFromActive: false,
    });
  });

  it('follows the org_id param, not the active flag', () => {
    // ORG_B is not active but is the one in the URL — selection must follow
    // the param so a multi-org manager buys for the org they came from.
    const result = resolve({ orgId: ORG_B });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.org.id).toBe(ORG_B);
    expect(result.isDifferentFromActive).toBe(true);
  });

  it('resolves not-member for an org the caller does not belong to', () => {
    expect(resolve({ orgId: '00000000-0000-4000-8000-0000000000ff' })).toEqual({
      status: 'not-member',
    });
  });

  it('refuses a membership whose role cannot bill, whatever the role is called', () => {
    // A role named `admin` without `org.billing.manage`: the name grants nothing.
    const orgs = [org({ id: ORG_A, name: 'WSB Merito', canBill: false, isActive: true })];
    const result = resolve({ orgs });
    expect(result).toEqual({
      status: 'not-billing',
      org: orgs[0],
      isDifferentFromActive: false,
    });
  });

  it('allows a membership whose role can bill, whatever the role is called', () => {
    // A role named `member` that carries `org.billing.manage` is the normal case
    // for a custom billing role, and the name must not close the control.
    const orgs = [
      org({ id: ORG_A, name: 'WSB Merito', canBill: true, orgRoleName: 'member', isActive: true }),
    ];
    expect(resolve({ orgs })).toEqual({
      status: 'ok',
      org: orgs[0],
      isDifferentFromActive: false,
    });
  });

  it('only flags a different active org when another org is positively active', () => {
    const noneActive = [
      org({ id: ORG_A, name: 'WSB Merito' }),
      org({ id: ORG_B, name: 'UE Wrocław' }),
    ];
    const result = resolve({ orgs: noneActive });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    // An unpinned `active_org_id` cookie must not read as "wrong org".
    expect(result.isDifferentFromActive).toBe(false);
  });

  it('does not flag the target org itself as different', () => {
    const result = resolve({});
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.isDifferentFromActive).toBe(false);
  });
});
