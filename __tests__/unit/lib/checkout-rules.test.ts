import { AccountType } from '@studiq/authz';
import {
  isOrganizationPlanFamily,
  resolveApplicablePlan,
  resolveCheckoutOwner,
  resolvePlanAssignment,
  resolvePurchasablePlan,
} from '@studiq/server/lib/payment/checkout-rules';
import type { CatalogPlan } from '@studiq/server/lib/payment/stripe-repository';
import { failure, success } from '@studiq/server/lib/service-result';
import { describe, expect, it, vi } from 'vitest';

const personalPlan: CatalogPlan = {
  key: 'plus',
  name: 'StudiQ Plus',
  priceMonthly: 1999,
  currency: 'PLN',
  isActive: true,
  scope: 'personal',
  sortOrder: 2,
  visibility: 'public',
  billingMode: 'stripe',
};
const orgPlan: CatalogPlan = {
  key: 'hub',
  name: 'StudiQ Hub',
  priceMonthly: 29900,
  currency: 'PLN',
  isActive: true,
  scope: 'organization',
  sortOrder: 7,
  visibility: 'public',
  billingMode: 'stripe',
};
const freePersonalPlan: CatalogPlan = {
  ...personalPlan,
  key: 'free',
  priceMonthly: 0,
};
const invoicePlan: CatalogPlan = { ...personalPlan, key: 'legacy', billingMode: 'invoice' };
const unlistedOrgPlan: CatalogPlan = {
  ...orgPlan,
  key: 'enterprise',
  visibility: 'unlisted',
};
const student = { userId: 'u-student', accountType: AccountType.STUDENT };
const manager = { userId: 'u-manager', accountType: AccountType.MANAGER };

function planPort(plan: CatalogPlan | null) {
  return { getPlan: vi.fn().mockResolvedValue(success(plan)) };
}

describe('resolveApplicablePlan', () => {
  it('accepts a free personal plan for a content subscriber (lifecycle, not purchase)', async () => {
    await expect(
      resolveApplicablePlan(planPort(freePersonalPlan), 'free', student),
    ).resolves.toEqual(success({ plan: freePersonalPlan, isOrgPlan: false }));
  });

  it('accepts a paid personal plan for a student or an educator', async () => {
    for (const caller of [student, { userId: 'u-educator', accountType: AccountType.EDUCATOR }]) {
      await expect(
        resolveApplicablePlan(planPort(personalPlan), personalPlan.key, caller),
      ).resolves.toEqual(success({ plan: personalPlan, isOrgPlan: false }));
    }
  });

  it('refuses a personal plan for a manager (ADR-0007)', async () => {
    for (const plan of [personalPlan, freePersonalPlan]) {
      await expect(resolveApplicablePlan(planPort(plan), plan.key, manager)).resolves.toEqual(
        failure('FORBIDDEN'),
      );
    }
  });

  it('accepts an organization plan for a manager; the owner rule decides which org', async () => {
    await expect(resolveApplicablePlan(planPort(orgPlan), 'hub', manager)).resolves.toEqual(
      success({ plan: orgPlan, isOrgPlan: true }),
    );
  });

  it.each([
    ['missing', null],
    ['inactive', { ...personalPlan, isActive: false }],
    ['invoice', invoicePlan],
    ['none', { ...personalPlan, key: 'comped', billingMode: 'none' }],
  ])('rejects a %s plan with BAD_REQUEST', async (_label, plan) => {
    await expect(resolveApplicablePlan(planPort(plan), 'plus', student)).resolves.toEqual(
      failure('BAD_REQUEST'),
    );
  });

  it('propagates a catalog read failure', async () => {
    const port = { getPlan: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(resolveApplicablePlan(port, 'plus', student)).resolves.toEqual(
      failure('INTERNAL_SERVER'),
    );
  });
});

describe('resolvePurchasablePlan', () => {
  it('accepts an active paid personal plan', async () => {
    await expect(resolvePurchasablePlan(planPort(personalPlan), 'plus', student)).resolves.toEqual(
      success({ plan: personalPlan, isOrgPlan: false }),
    );
  });

  it('refuses a paid personal plan for a manager (ADR-0007)', async () => {
    await expect(resolvePurchasablePlan(planPort(personalPlan), 'plus', manager)).resolves.toEqual(
      failure('FORBIDDEN'),
    );
  });

  it('flags an organization-scope plan as an organization plan for a manager', async () => {
    const result = await resolvePurchasablePlan(planPort(orgPlan), 'hub', manager);
    expect(result.success && result.data.isOrgPlan).toBe(true);
  });

  it.each([
    ['missing', null, 'BAD_REQUEST'],
    ['inactive', { ...personalPlan, isActive: false }, 'BAD_REQUEST'],
    ['free', freePersonalPlan, 'BAD_REQUEST'],
  ])('rejects a %s plan', async (_label, plan, error) => {
    await expect(resolvePurchasablePlan(planPort(plan), 'plus', student)).resolves.toEqual(
      failure(error),
    );
  });

  it('propagates a catalog read failure', async () => {
    const port = { getPlan: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')) };
    await expect(resolvePurchasablePlan(port, 'plus', student)).resolves.toEqual(
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

describe('resolvePlanAssignment (B3)', () => {
  const orgOwner = {
    type: 'org' as const,
    orgId: 'org-1',
    userId: 'u-1',
    accountType: AccountType.MANAGER,
  };
  const userOwner = {
    type: 'user' as const,
    userId: 'u-1',
    accountType: AccountType.STUDENT,
  };

  it('accepts a public plan without an assignment read', async () => {
    const port = { planIsAssignedToOrg: vi.fn() };

    await expect(resolvePlanAssignment(port, orgPlan, orgOwner)).resolves.toEqual(success(null));
    expect(port.planIsAssignedToOrg).not.toHaveBeenCalled();
  });

  it('accepts an unlisted plan for its assigned organization', async () => {
    const port = { planIsAssignedToOrg: vi.fn().mockResolvedValue(success(true)) };

    await expect(resolvePlanAssignment(port, unlistedOrgPlan, orgOwner)).resolves.toEqual(
      success(null),
    );
    expect(port.planIsAssignedToOrg).toHaveBeenCalledWith('enterprise', 'org-1');
  });

  it('refuses an unlisted plan for an organization it is not assigned to', async () => {
    const port = { planIsAssignedToOrg: vi.fn().mockResolvedValue(success(false)) };

    await expect(resolvePlanAssignment(port, unlistedOrgPlan, orgOwner)).resolves.toEqual(
      failure('FORBIDDEN'),
    );
  });

  it('refuses an unlisted plan for a personal owner without a read', async () => {
    // A contract plan belongs to an organization; a user owner can never hold
    // one, so the answer does not need a database call.
    const port = { planIsAssignedToOrg: vi.fn() };

    await expect(
      resolvePlanAssignment(port, { ...invoicePlan, visibility: 'unlisted' }, userOwner),
    ).resolves.toEqual(failure('FORBIDDEN'));
    expect(port.planIsAssignedToOrg).not.toHaveBeenCalled();
  });

  it('propagates an assignment read failure', async () => {
    const port = {
      planIsAssignedToOrg: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')),
    };

    await expect(resolvePlanAssignment(port, unlistedOrgPlan, orgOwner)).resolves.toEqual(
      failure('INTERNAL_SERVER'),
    );
  });
});
