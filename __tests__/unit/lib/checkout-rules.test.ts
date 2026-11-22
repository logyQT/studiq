import { AccountType } from '@studiq/authz';
import {
  isOrganizationPlanFamily,
  resolveApplicablePlan,
  resolveCheckoutOwner,
  resolvePurchasablePlan,
} from '@studiq/server/lib/payment/checkout-rules';
import type { CatalogPlan } from '@studiq/server/lib/payment/stripe-repository';
import { failure, success } from '@studiq/server/lib/service-result';
import { describe, expect, it, vi } from 'vitest';

const studentPlan: CatalogPlan = {
  key: 'spark',
  name: 'StudiQ Spark',
  priceMonthly: 999,
  currency: 'PLN',
  isActive: true,
  scope: 'personal',
  audience: 'student',
  sortOrder: 1,
};
const orgPlan: CatalogPlan = {
  key: 'hub',
  name: 'StudiQ Hub',
  priceMonthly: 29900,
  currency: 'PLN',
  isActive: true,
  scope: 'organization',
  audience: null,
  sortOrder: 7,
};
const freeStudentPlan: CatalogPlan = {
  ...studentPlan,
  key: 'base',
  priceMonthly: 0,
};
const soloPlan: CatalogPlan = {
  ...studentPlan,
  key: 'solo',
  priceMonthly: 0,
  audience: 'manager',
};
const educatorPlan: CatalogPlan = { ...studentPlan, key: 'guide', audience: 'educator' };

function planPort(plan: CatalogPlan | null) {
  return { getPlan: vi.fn().mockResolvedValue(success(plan)) };
}

describe('resolveApplicablePlan', () => {
  it('accepts a free plan of the caller audience (lifecycle, not purchase)', async () => {
    await expect(
      resolveApplicablePlan(planPort(freeStudentPlan), 'base', AccountType.STUDENT),
    ).resolves.toEqual(success({ plan: freeStudentPlan, isOrgPlan: false }));
  });

  it('checks the audience before the price', async () => {
    await expect(
      resolveApplicablePlan(planPort(freeStudentPlan), 'base', AccountType.EDUCATOR),
    ).resolves.toEqual(failure('FORBIDDEN'));
  });

  it('accepts an organization plan for any account type — it has no audience check (D34)', async () => {
    await expect(
      resolveApplicablePlan(planPort(orgPlan), 'hub', AccountType.STUDENT),
    ).resolves.toEqual(success({ plan: orgPlan, isOrgPlan: true }));
  });

  it.each([
    ['missing', null, 'BAD_REQUEST'],
    ['inactive', { ...studentPlan, isActive: false }, 'BAD_REQUEST'],
    ['organization plan for a student is not an audience refusal', orgPlan, undefined],
    ['another audience', educatorPlan, 'FORBIDDEN'],
    ['manager personal plan for a student', soloPlan, 'FORBIDDEN'],
  ])('resolveApplicablePlan: %s', async (_label, plan, error) => {
    const result = await resolveApplicablePlan(planPort(plan), 'spark', AccountType.STUDENT);
    if (error === undefined) {
      expect(result).toEqual(success({ plan, isOrgPlan: plan === orgPlan }));
    } else {
      expect(result).toEqual(failure(error));
    }
  });
});

describe('resolvePurchasablePlan', () => {
  it('accepts an active paid plan of the caller audience', async () => {
    await expect(
      resolvePurchasablePlan(planPort(studentPlan), 'spark', AccountType.STUDENT),
    ).resolves.toEqual(success({ plan: studentPlan, isOrgPlan: false }));
  });

  it('flags an organization-scope plan as an organization plan for any caller', async () => {
    const result = await resolvePurchasablePlan(planPort(orgPlan), 'hub', AccountType.STUDENT);
    expect(result.success && result.data.isOrgPlan).toBe(true);
  });

  it.each([
    ['missing', null, 'BAD_REQUEST'],
    ['inactive', { ...studentPlan, isActive: false }, 'BAD_REQUEST'],
    ['free', freeStudentPlan, 'BAD_REQUEST'],
    ['another audience', educatorPlan, 'FORBIDDEN'],
    ['free from another audience', { ...freeStudentPlan, audience: 'educator' }, 'FORBIDDEN'],
    ['manager personal plan for a student', soloPlan, 'FORBIDDEN'],
  ])('rejects a %s plan', async (_label, plan, error) => {
    await expect(
      resolvePurchasablePlan(planPort(plan), 'spark', AccountType.STUDENT),
    ).resolves.toEqual(failure(error));
  });

  it('propagates a catalog read failure', async () => {
    const port = { getPlan: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(resolvePurchasablePlan(port, 'spark', AccountType.STUDENT)).resolves.toEqual(
      failure('INTERNAL_SERVER'),
    );
  });
});

describe('isOrganizationPlanFamily', () => {
  it('recognizes only the organization scope', () => {
    expect(isOrganizationPlanFamily({ scope: 'organization' })).toBe(true);
    expect(isOrganizationPlanFamily({ scope: 'personal' })).toBe(false);
  });
});

describe('resolveCheckoutOwner', () => {
  const caller = { userId: 'u-1', accountType: AccountType.MANAGER };

  it('resolves the caller for a personal plan and ignores an org id', async () => {
    const port = { canManageBilling: vi.fn() };
    await expect(
      resolveCheckoutOwner(
        port,
        { plan: studentPlan, isOrgPlan: false },
        { userId: 'u-1', accountType: AccountType.STUDENT },
        'org-1',
      ),
    ).resolves.toEqual(success({ type: 'user', userId: 'u-1', accountType: AccountType.STUDENT }));
    expect(port.canManageBilling).not.toHaveBeenCalled();
  });

  it('resolves the org for an organization plan when the caller holds org.billing.manage there', async () => {
    const port = { canManageBilling: vi.fn().mockResolvedValue(success(true)) };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller, 'org-1'),
    ).resolves.toEqual(
      success({
        type: 'org',
        orgId: 'org-1',
        userId: 'u-1',
        accountType: AccountType.MANAGER,
      }),
    );
    expect(port.canManageBilling).toHaveBeenCalledWith('org-1', 'u-1');
  });

  it('checks the explicit target org, not an active-org one (billing in B while A is active)', async () => {
    const port = { canManageBilling: vi.fn().mockResolvedValue(success(true)) };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller, 'org-2'),
    ).resolves.toMatchObject(success({ type: 'org', orgId: 'org-2', userId: 'u-1' }));
    expect(port.canManageBilling).toHaveBeenCalledWith('org-2', 'u-1');
  });

  it('answers FORBIDDEN (not BAD_REQUEST) when an organization plan arrives without an org id', async () => {
    const port = { canManageBilling: vi.fn() };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller),
    ).resolves.toEqual(failure('FORBIDDEN'));
    expect(port.canManageBilling).not.toHaveBeenCalled();
  });

  it('refuses an org plan for a caller without org.billing.manage in the target org', async () => {
    const port = { canManageBilling: vi.fn().mockResolvedValue(success(false)) };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller, 'org-1'),
    ).resolves.toEqual(failure('FORBIDDEN'));
  });

  it('propagates a permission read failure', async () => {
    const port = { canManageBilling: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller, 'org-1'),
    ).resolves.toEqual(failure('INTERNAL_SERVER'));
  });
});
