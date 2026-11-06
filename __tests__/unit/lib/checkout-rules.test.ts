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
  forAccountType: 'student',
  sortOrder: 1,
};
const orgPlan: CatalogPlan = {
  key: 'hub',
  name: 'StudiQ Hub',
  priceMonthly: 29900,
  currency: 'PLN',
  isActive: true,
  forAccountType: 'manager',
  sortOrder: 7,
};
const anyPlan: CatalogPlan = { ...orgPlan, key: 'everyone', forAccountType: null };
const freeStudentPlan: CatalogPlan = { ...studentPlan, key: 'base', priceMonthly: 0 };
const unknownFamilyPlan: CatalogPlan = { ...orgPlan, key: 'weird', forAccountType: 'wizard' };

function planPort(plan: CatalogPlan | null) {
  return { getPlan: vi.fn().mockResolvedValue(success(plan)) };
}

describe('resolveApplicablePlan', () => {
  it('accepts a free plan of the caller family (lifecycle, not purchase)', async () => {
    await expect(
      resolveApplicablePlan(planPort(freeStudentPlan), 'base', AccountType.STUDENT),
    ).resolves.toEqual(success({ plan: freeStudentPlan, isOrgPlan: false }));
  });

  it('checks the family before the price', async () => {
    await expect(
      resolveApplicablePlan(planPort(freeStudentPlan), 'base', AccountType.EDUCATOR),
    ).resolves.toEqual(failure('FORBIDDEN'));
  });

  it('accepts a plan with no family for any account type and never marks it as an org plan', async () => {
    await expect(
      resolveApplicablePlan(planPort(anyPlan), 'everyone', AccountType.EDUCATOR),
    ).resolves.toEqual(success({ plan: anyPlan, isOrgPlan: false }));
  });

  it.each([
    ['missing', null, 'BAD_REQUEST'],
    ['inactive', { ...studentPlan, isActive: false }, 'BAD_REQUEST'],
    ['another family', orgPlan, 'FORBIDDEN'],
    ['unknown family', unknownFamilyPlan, 'FORBIDDEN'],
  ])('rejects a %s plan', async (_label, plan, error) => {
    await expect(
      resolveApplicablePlan(planPort(plan), 'spark', AccountType.STUDENT),
    ).resolves.toEqual(failure(error));
  });
});

describe('resolvePurchasablePlan', () => {
  it('accepts an active paid plan of the caller family', async () => {
    await expect(
      resolvePurchasablePlan(planPort(studentPlan), 'spark', AccountType.STUDENT),
    ).resolves.toEqual(success({ plan: studentPlan, isOrgPlan: false }));
  });

  it('flags the manager family as an organization plan', async () => {
    const result = await resolvePurchasablePlan(planPort(orgPlan), 'hub', AccountType.MANAGER);
    expect(result.success && result.data.isOrgPlan).toBe(true);
  });

  it('accepts a paid plan with no family for any account type', async () => {
    const result = await resolvePurchasablePlan(
      planPort(anyPlan),
      'everyone',
      AccountType.EDUCATOR,
    );
    expect(result).toEqual(success({ plan: anyPlan, isOrgPlan: false }));
  });

  it.each([
    ['missing', null, 'BAD_REQUEST'],
    ['inactive', { ...studentPlan, isActive: false }, 'BAD_REQUEST'],
    ['free', freeStudentPlan, 'BAD_REQUEST'],
    ['another family', orgPlan, 'FORBIDDEN'],
    ['free from another family', { ...freeStudentPlan, forAccountType: 'educator' }, 'FORBIDDEN'],
    ['unknown family', unknownFamilyPlan, 'FORBIDDEN'],
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
  it('recognizes only the manager family', () => {
    expect(isOrganizationPlanFamily({ forAccountType: 'manager' })).toBe(true);
    expect(isOrganizationPlanFamily({ forAccountType: 'student' })).toBe(false);
    expect(isOrganizationPlanFamily({ forAccountType: null })).toBe(false);
  });
});

describe('resolveCheckoutOwner', () => {
  const caller = { userId: 'u-1', accountType: AccountType.MANAGER };

  it('resolves the caller for a personal plan and ignores an org id', async () => {
    const port = { isOrgAdmin: vi.fn() };
    await expect(
      resolveCheckoutOwner(
        port,
        { plan: studentPlan, isOrgPlan: false },
        { userId: 'u-1', accountType: AccountType.STUDENT },
        'org-1',
      ),
    ).resolves.toEqual(success({ type: 'user', userId: 'u-1', accountType: AccountType.STUDENT }));
    expect(port.isOrgAdmin).not.toHaveBeenCalled();
  });

  it('resolves the verified org for an organization plan', async () => {
    const port = { isOrgAdmin: vi.fn().mockResolvedValue(success(true)) };
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
    expect(port.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-1');
  });

  it('requires an org id for an organization plan', async () => {
    const port = { isOrgAdmin: vi.fn() };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller),
    ).resolves.toEqual(failure('BAD_REQUEST'));
    expect(port.isOrgAdmin).not.toHaveBeenCalled();
  });

  it('refuses an org plan for a caller who is not an admin', async () => {
    const port = { isOrgAdmin: vi.fn().mockResolvedValue(success(false)) };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller, 'org-1'),
    ).resolves.toEqual(failure('FORBIDDEN'));
  });

  it('propagates a membership read failure', async () => {
    const port = { isOrgAdmin: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(
      resolveCheckoutOwner(port, { plan: orgPlan, isOrgPlan: true }, caller, 'org-1'),
    ).resolves.toEqual(failure('INTERNAL_SERVER'));
  });
});
