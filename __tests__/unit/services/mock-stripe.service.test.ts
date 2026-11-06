import { AccountType } from '@studiq/authz';
import type {
  PaymentHistoryInput,
  PaymentHistoryWriter,
} from '@studiq/server/lib/payment/payment-history.repository';
import type {
  CatalogPlan,
  StripeBillingRepository,
} from '@studiq/server/lib/payment/stripe-repository';
import { failure, success } from '@studiq/server/lib/service-result';
import type { EntitlementService } from '@studiq/server/services/entitlement.service';
import { MockStripeService } from '@studiq/server/services/mock-stripe.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  key: 'campus',
  name: 'StudiQ Campus',
  priceMonthly: 69900,
  currency: 'PLN',
  isActive: true,
  forAccountType: 'manager',
  sortOrder: 8,
};
const freeStudentPlan: CatalogPlan = {
  key: 'base',
  name: 'StudiQ Base',
  priceMonthly: 0,
  currency: 'PLN',
  isActive: true,
  forAccountType: 'student',
  sortOrder: 0,
};
const freeManagerPlan: CatalogPlan = {
  key: 'launch',
  name: 'StudiQ Launch',
  priceMonthly: 0,
  currency: 'PLN',
  isActive: true,
  forAccountType: 'manager',
  sortOrder: 3,
};
const inactivePlan: CatalogPlan = { ...studentPlan, key: 'old', isActive: false };

const event = {
  type: 'checkout.session.completed',
  session_id: 's-1',
  plan_id: 'spark',
};

type Rules = Pick<StripeBillingRepository, 'getPlan' | 'isOrgAdmin'>;
type Entitlements = Pick<EntitlementService, 'applyPlan'>;

describe('MockStripeService', () => {
  let rules: Rules;
  let entitlements: Entitlements;
  let payments: PaymentHistoryWriter;
  let service: MockStripeService;

  function mockPlan(plan: CatalogPlan | null) {
    vi.mocked(rules.getPlan).mockResolvedValue(success(plan));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rules = {
      getPlan: vi.fn().mockResolvedValue(success(studentPlan)),
      isOrgAdmin: vi.fn().mockResolvedValue(success(true)),
    };
    entitlements = { applyPlan: vi.fn().mockResolvedValue(success(undefined)) };
    payments = {
      record: vi.fn().mockResolvedValue(success({ outcome: 'inserted', existing: null })),
    };
    service = new MockStripeService(rules, entitlements, payments);
  });

  it('ignores events other than checkout.session.completed', async () => {
    const result = await service.handleWebhook(
      { ...event, type: 'other' },
      AccountType.STUDENT,
      'u-1',
    );
    expect(result.success).toBe(true);
    expect(rules.getPlan).not.toHaveBeenCalled();
    expect(entitlements.applyPlan).not.toHaveBeenCalled();
  });

  it('records a paid personal purchase through the shared writer, then applies it via EntitlementService', async () => {
    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(success(undefined));
    expect(payments.record).toHaveBeenCalledWith({
      provider: 'mock',
      userId: 'u-1',
      organizationId: null,
      planKey: 'spark',
      planName: 'StudiQ Spark',
      amount: 999,
      currency: 'PLN',
      sessionId: 's-1',
    } satisfies PaymentHistoryInput);
    expect(entitlements.applyPlan).toHaveBeenCalledWith({ type: 'user', userId: 'u-1' }, 'spark');
  });

  it('applies a free plan as a lifecycle change without a payment row', async () => {
    mockPlan(freeStudentPlan);

    const result = await service.handleWebhook(
      { ...event, plan_id: 'base' },
      AccountType.STUDENT,
      'u-1',
    );

    expect(result).toEqual(success(undefined));
    expect(payments.record).not.toHaveBeenCalled();
    expect(entitlements.applyPlan).toHaveBeenCalledWith({ type: 'user', userId: 'u-1' }, 'base');
  });

  describe('organization plans', () => {
    const orgEvent = { ...event, plan_id: 'campus', org_id: 'org-1' };

    it('moves the org through EntitlementService and never touches the buyer personal plan', async () => {
      mockPlan(orgPlan);

      const result = await service.handleWebhook(orgEvent, AccountType.MANAGER, 'u-1');

      expect(result).toEqual(success(undefined));
      expect(rules.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-1');
      expect(entitlements.applyPlan).toHaveBeenCalledWith(
        { type: 'org', orgId: 'org-1' },
        'campus',
      );
      // Only the organization owner is passed to the entitlement writer: the
      // manager's personal plan stays the free `launch` tier (#228).
      expect(entitlements.applyPlan).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user' }),
        expect.anything(),
      );
      expect(payments.record).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'mock',
          userId: 'u-1',
          organizationId: 'org-1',
          planKey: 'campus',
        }),
      );
    });

    it('applies a free manager plan to the org (QA downgrade fixture)', async () => {
      mockPlan(freeManagerPlan);

      const result = await service.handleWebhook(
        { ...orgEvent, plan_id: 'launch' },
        AccountType.MANAGER,
        'u-1',
      );

      expect(result).toEqual(success(undefined));
      expect(payments.record).not.toHaveBeenCalled();
      expect(entitlements.applyPlan).toHaveBeenCalledWith(
        { type: 'org', orgId: 'org-1' },
        'launch',
      );
    });

    it('requires an org id to complete an org plan purchase', async () => {
      mockPlan(orgPlan);

      const result = await service.handleWebhook(
        { ...orgEvent, org_id: undefined },
        AccountType.MANAGER,
        'u-1',
      );

      expect(result).toEqual(failure('BAD_REQUEST'));
      expect(payments.record).not.toHaveBeenCalled();
      expect(entitlements.applyPlan).not.toHaveBeenCalled();
    });

    it('refuses an org the caller does not administer', async () => {
      mockPlan(orgPlan);
      vi.mocked(rules.isOrgAdmin).mockResolvedValue(success(false));

      const result = await service.handleWebhook(orgEvent, AccountType.MANAGER, 'u-1');

      expect(result).toEqual(failure('FORBIDDEN'));
      expect(payments.record).not.toHaveBeenCalled();
      expect(entitlements.applyPlan).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['a plan from another family', orgPlan],
    ['a free plan from another family', { ...freeStudentPlan, forAccountType: 'educator' }],
  ])('rejects %s with FORBIDDEN before the price check', async (_label, plan) => {
    mockPlan(plan);

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(failure('FORBIDDEN'));
    expect(payments.record).not.toHaveBeenCalled();
    expect(entitlements.applyPlan).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['inactive', inactivePlan],
  ])('rejects a %s plan as not applicable', async (_label, plan) => {
    mockPlan(plan);

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(failure('BAD_REQUEST'));
    expect(payments.record).not.toHaveBeenCalled();
    expect(entitlements.applyPlan).not.toHaveBeenCalled();
  });

  it('does not apply the entitlement when the payment write fails', async () => {
    vi.mocked(payments.record).mockResolvedValue(failure('INTERNAL_SERVER'));

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(failure('INTERNAL_SERVER'));
    expect(entitlements.applyPlan).not.toHaveBeenCalled();
  });

  it('reports an entitlement failure after the row was recorded (retry self-heals)', async () => {
    vi.mocked(entitlements.applyPlan).mockResolvedValue(failure('INTERNAL_SERVER'));

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(failure('INTERNAL_SERVER'));
    expect(payments.record).toHaveBeenCalledTimes(1);
  });

  it('re-applies the same purchase when the session is replayed', async () => {
    vi.mocked(payments.record).mockResolvedValue(
      success({
        outcome: 'duplicate',
        existing: { userId: 'u-1', organizationId: null, planKey: 'spark' },
      }),
    );

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(success(undefined));
    expect(entitlements.applyPlan).toHaveBeenCalledWith({ type: 'user', userId: 'u-1' }, 'spark');
  });

  it.each([
    [
      'another owner',
      {
        outcome: 'duplicate' as const,
        existing: { userId: 'victim', organizationId: null, planKey: 'spark' },
      },
    ],
    [
      'another plan',
      {
        outcome: 'duplicate' as const,
        existing: { userId: 'u-1', organizationId: null, planKey: 'ace' },
      },
    ],
    [
      'another organization',
      {
        outcome: 'duplicate' as const,
        existing: { userId: 'u-1', organizationId: 'org-2', planKey: 'campus' },
      },
    ],
  ])('refuses a session id that already belongs to %s', async (_label, record) => {
    vi.mocked(payments.record).mockResolvedValue(success(record));

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(failure('CONFLICT'));
    expect(entitlements.applyPlan).not.toHaveBeenCalled();
  });

  it('propagates a catalog read failure without writing', async () => {
    vi.mocked(rules.getPlan).mockResolvedValue(failure('INTERNAL_SERVER'));

    const result = await service.handleWebhook(event, AccountType.STUDENT, 'u-1');

    expect(result).toEqual(failure('INTERNAL_SERVER'));
    expect(payments.record).not.toHaveBeenCalled();
    expect(entitlements.applyPlan).not.toHaveBeenCalled();
  });
});
