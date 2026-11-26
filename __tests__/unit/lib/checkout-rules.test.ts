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

const personalPlan: CatalogPlan = {
  key: 'spark',
  name: 'StudiQ Plus',
  priceMonthly: 1999,
  currency: 'PLN',
  isActive: true,
  scope: 'personal',
  audience: null,
  sortOrder: 2,
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
const freePersonalPlan: CatalogPlan = {
  ...personalPlan,
  key: 'base',
  priceMonthly: 0,
};
/**
 * A personal row written before #1193 still names an audience. It is a legal
 * catalogue row until the migration re-points or deletes it, so the checkout
 * must not refuse it by persona.
 */
const legacyAudiencePlan: CatalogPlan = { ...personalPlan, key: 'ace', audience: 'student' };

function planPort(plan: CatalogPlan | null) {
  return { getPlan: vi.fn().mockResolvedValue(success(plan)) };
}

describe('resolveApplicablePlan', () => {
  it('accepts a free personal plan (lifecycle, not purchase)', async () => {
    await expect(resolveApplicablePlan(planPort(freePersonalPlan), 'base')).resolves.toEqual(
      success({ plan: freePersonalPlan, isOrgPlan: false }),
    );
  });

  it('accepts a paid personal plan for any caller: the ladder has no audience (#1193)', async () => {
    for (const plan of [personalPlan, legacyAudiencePlan]) {
      await expect(resolveApplicablePlan(planPort(plan), plan.key)).resolves.toEqual(
        success({ plan, isOrgPlan: false }),
      );
    }
  });

  it('accepts an organization plan; the owner rule decides who may buy it', async () => {
    await expect(resolveApplicablePlan(planPort(orgPlan), 'hub')).resolves.toEqual(
      success({ plan: orgPlan, isOrgPlan: true }),
    );
  });

  it.each([
    ['missing', null],
    ['inactive', { ...personalPlan, isActive: false }],
  ])('rejects a %s plan with BAD_REQUEST', async (_label, plan) => {
    await expect(resolveApplicablePlan(planPort(plan), 'spark')).resolves.toEqual(
      failure('BAD_REQUEST'),
    );
  });

  it('propagates a catalog read failure', async () => {
    const port = { getPlan: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(resolveApplicablePlan(port, 'spark')).resolves.toEqual(failure('INTERNAL_SERVER'));
  });
});

describe('resolvePurchasablePlan', () => {
  it('accepts an active paid personal plan', async () => {
    await expect(resolvePurchasablePlan(planPort(personalPlan), 'spark')).resolves.toEqual(
      success({ plan: personalPlan, isOrgPlan: false }),
    );
  });

  it('accepts a legacy personal row that still names an audience', async () => {
    await expect(resolvePurchasablePlan(planPort(legacyAudiencePlan), 'ace')).resolves.toEqual(
      success({ plan: legacyAudiencePlan, isOrgPlan: false }),
    );
  });

  it('flags an organization-scope plan as an organization plan for any caller', async () => {
    const result = await resolvePurchasablePlan(planPort(orgPlan), 'hub');
    expect(result.success && result.data.isOrgPlan).toBe(true);
  });

  it.each([
    ['missing', null, 'BAD_REQUEST'],
    ['inactive', { ...personalPlan, isActive: false }, 'BAD_REQUEST'],
    ['free', freePersonalPlan, 'BAD_REQUEST'],
  ])('rejects a %s plan', async (_label, plan, error) => {
    await expect(resolvePurchasablePlan(planPort(plan), 'spark')).resolves.toEqual(failure(error));
  });

  it('propagates a catalog read failure', async () => {
    const port = { getPlan: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(resolvePurchasablePlan(port, 'spark')).resolves.toEqual(
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
        { plan: personalPlan, isOrgPlan: false },
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
