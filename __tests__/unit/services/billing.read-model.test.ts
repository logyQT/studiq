import { AccountType, type RequestContext } from '@studiq/authz';
import type {
  BillingReadRepository,
  SubscriptionReadRow,
} from '@studiq/server/lib/payment/billing-read.repository';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import type {
  CatalogPlan,
  StripeBillingRepository,
} from '@studiq/server/lib/payment/stripe-repository';
import { failure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import type {
  PlanInfo,
  SubscriptionPlanService,
} from '@studiq/server/services/subscription-plan.service';
import { BillingService } from '@studiq/server/services/billing.service';
import { asJson } from '#test/helpers/json';
import { asService } from '#test/helpers/service-double';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const studentCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

const managerCtx: RequestContext = {
  ...studentCtx,
  userId: 'u-9',
  accountType: AccountType.MANAGER,
  activeOrgId: 'org-1',
};

function planInfo(overrides: Partial<PlanInfo> = {}): PlanInfo {
  return {
    id: 'plan-1',
    key: 'spark',
    name: 'StudiQ Spark',
    description: null,
    priceMonthly: 999,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder: 1,
    isActive: true,
    forAccountType: 'student',
    ...overrides,
  };
}

function catalogPlan(overrides: Partial<CatalogPlan> = {}): CatalogPlan {
  return {
    key: 'spark',
    name: 'StudiQ Spark',
    priceMonthly: 999,
    currency: 'PLN',
    isActive: true,
    forAccountType: 'student',
    sortOrder: 1,
    ...overrides,
  };
}

function subscriptionRow(overrides: Partial<SubscriptionReadRow> = {}): SubscriptionReadRow {
  return {
    stripeSubscriptionId: 'sub_1',
    planKey: 'spark',
    status: 'active',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    pendingPlanKey: null,
    ...overrides,
  };
}

function createGateway(driver: 'mock' | 'stripe' = 'stripe'): PaymentGateway {
  return {
    driver,
    livemode: false,
    createCheckoutSession: vi.fn<PaymentGateway['createCheckoutSession']>(),
    createPortalSession: vi
      .fn<PaymentGateway['createPortalSession']>()
      .mockImplementation((input) => Promise.resolve(success({ url: input.returnUrl }))),
    changePlan: vi.fn<PaymentGateway['changePlan']>(),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  };
}

function createRepository(
  overrides: Partial<StripeBillingRepository> = {},
): StripeBillingRepository {
  return asJson<StripeBillingRepository>({
    getPlan: vi.fn().mockResolvedValue(success(catalogPlan())),
    isOrgAdmin: vi.fn().mockResolvedValue(success(true)),
    findCustomer: vi.fn().mockResolvedValue(success({ stripeCustomerId: 'cus_1' })),
    insertCustomer: vi.fn(),
    getCustomerDetails: vi.fn(),
    findPriceById: vi.fn(),
    findListedPrice: vi.fn(),
    findActiveSubscription: vi.fn().mockResolvedValue(success(null)),
    ...overrides,
  });
}

function createReads(overrides: Partial<BillingReadRepository> = {}): BillingReadRepository {
  return asJson<BillingReadRepository>({
    findSubscription: vi.fn().mockResolvedValue(success(null)),
    findLatestHostedInvoiceUrl: vi.fn().mockResolvedValue(success(null)),
    ...overrides,
  });
}

function createPlans(result: ServiceResult<PlanInfo> = success(planInfo())) {
  return asService<Pick<SubscriptionPlanService, 'getMyPlan'>>({
    getMyPlan: vi.fn().mockResolvedValue(result),
  });
}

describe('BillingService.getSubscription', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let reads: BillingReadRepository;
  let plans: Pick<SubscriptionPlanService, 'getMyPlan'>;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    reads = createReads();
    plans = createPlans();
    service = new BillingService(gateway, repository, reads, plans);
  });

  it('synthesizes an active provider-agnostic model from the mock entitlement', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository, reads, plans);

    const result = await service.getSubscription(studentCtx);

    expect(result).toEqual(
      success({
        provider: 'mock',
        planKey: 'spark',
        planName: 'StudiQ Spark',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        pendingPlanKey: null,
        priceMonthly: 999,
        currency: 'PLN',
        canManagePortal: false,
        canChangePlan: false,
        canCancel: false,
        hostedInvoiceUrl: null,
      }),
    );
    // The mock has no billing row, no hosted invoice and no hosted portal.
    expect(reads.findSubscription).not.toHaveBeenCalled();
    expect(reads.findLatestHostedInvoiceUrl).not.toHaveBeenCalled();
    expect(repository.getPlan).not.toHaveBeenCalled();
  });

  it('marks a free mock plan as free', async () => {
    gateway = createGateway('mock');
    plans = createPlans(success(planInfo({ key: 'base', name: 'StudiQ Base', priceMonthly: 0 })));
    service = new BillingService(gateway, repository, reads, plans);

    const result = await service.getSubscription(studentCtx);

    expect(result).toMatchObject({
      success: true,
      data: { provider: 'mock', status: 'free', planKey: 'base', priceMonthly: 0 },
    });
  });

  it('still answers a caller with no plan yet', async () => {
    plans = createPlans(failure('NOT_FOUND'));
    service = new BillingService(gateway, repository, reads, plans);

    const result = await service.getSubscription(studentCtx);

    expect(result).toMatchObject({
      success: true,
      data: { planKey: null, status: 'none', priceMonthly: 0 },
    });
  });

  it('propagates a real plan read failure instead of hiding it', async () => {
    plans = createPlans(failure('INTERNAL_SERVER'));
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('falls back to the effective plan when Stripe has no mirror row yet', async () => {
    const result = await service.getSubscription(studentCtx);

    expect(result).toMatchObject({
      success: true,
      data: {
        provider: 'stripe',
        planKey: 'spark',
        status: 'active',
        currentPeriodEnd: null,
        canManagePortal: false,
        canChangePlan: false,
        canCancel: false,
        hostedInvoiceUrl: null,
      },
    });
    expect(reads.findSubscription).toHaveBeenCalledWith(studentCtx, false);
    expect(reads.findLatestHostedInvoiceUrl).not.toHaveBeenCalled();
  });

  it('returns the Stripe mirror state, dates, pending plan and action flags', async () => {
    reads = createReads({
      findSubscription: vi
        .fn()
        .mockResolvedValue(success(subscriptionRow({ pendingPlanKey: 'guide' }))),
      findLatestHostedInvoiceUrl: vi
        .fn()
        .mockResolvedValue(success('https://invoice.stripe.com/i/1')),
    });
    service = new BillingService(gateway, repository, reads, plans);

    const result = await service.getSubscription(studentCtx);

    expect(result).toEqual(
      success({
        provider: 'stripe',
        planKey: 'spark',
        planName: 'StudiQ Spark',
        status: 'active',
        currentPeriodEnd: '2026-12-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        pendingPlanKey: 'guide',
        priceMonthly: 999,
        currency: 'PLN',
        canManagePortal: true,
        canChangePlan: true,
        canCancel: true,
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/1',
      }),
    );
    expect(reads.findLatestHostedInvoiceUrl).toHaveBeenCalledWith({
      userId: 'u-1',
      organizationId: null,
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('keeps the resume state for an active subscription scheduled to cancel', async () => {
    reads = createReads({
      findSubscription: vi
        .fn()
        .mockResolvedValue(success(subscriptionRow({ cancelAtPeriodEnd: true }))),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toMatchObject({
      success: true,
      data: {
        status: 'active',
        cancelAtPeriodEnd: true,
        canChangePlan: true,
        canCancel: true,
      },
    });
  });

  it('hides a pending marker that already equals the applied plan', async () => {
    reads = createReads({
      findSubscription: vi
        .fn()
        .mockResolvedValue(success(subscriptionRow({ planKey: 'spark', pendingPlanKey: 'spark' }))),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toMatchObject({
      success: true,
      data: { planKey: 'spark', pendingPlanKey: null },
    });
  });

  it('disables plan changes for a canceled subscription while keeping portal access', async () => {
    reads = createReads({
      findSubscription: vi
        .fn()
        .mockResolvedValue(
          success(subscriptionRow({ status: 'canceled', cancelAtPeriodEnd: true })),
        ),
    });
    service = new BillingService(gateway, repository, reads, plans);

    const result = await service.getSubscription(studentCtx);

    expect(result).toMatchObject({
      success: true,
      data: {
        status: 'canceled',
        cancelAtPeriodEnd: true,
        canManagePortal: true,
        canChangePlan: false,
        canCancel: false,
      },
    });
  });

  it('keeps access and actions for a past_due subscription (D14)', async () => {
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(success(subscriptionRow({ status: 'past_due' }))),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toMatchObject({
      success: true,
      data: { status: 'past_due', canChangePlan: true, canCancel: true },
    });
  });

  it('shows the effective (seat) plan while lifecycle state comes from the mirror', async () => {
    plans = createPlans(
      success(
        planInfo({ key: 'ace', name: 'StudiQ Ace', priceMonthly: 4999, forAccountType: 'manager' }),
      ),
    );
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(success(subscriptionRow({ planKey: 'spark' }))),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toMatchObject({
      success: true,
      data: { planKey: 'ace', planName: 'StudiQ Ace', priceMonthly: 4999, status: 'active' },
    });
    expect(repository.getPlan).not.toHaveBeenCalled();
  });

  it('falls back to the catalog row when the caller has no effective plan', async () => {
    plans = createPlans(failure('NOT_FOUND'));
    reads = createReads({
      findSubscription: vi
        .fn()
        .mockResolvedValue(success(subscriptionRow({ planKey: 'ace', status: 'active' }))),
    });
    vi.mocked(repository.getPlan).mockResolvedValueOnce(
      success(catalogPlan({ key: 'ace', name: 'StudiQ Ace', priceMonthly: 4999 })),
    );
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toMatchObject({
      success: true,
      data: { planKey: 'ace', planName: 'StudiQ Ace', priceMonthly: 4999 },
    });
    expect(repository.getPlan).toHaveBeenCalledWith('ace');
  });

  it('propagates a catalog failure while falling back', async () => {
    plans = createPlans(failure('NOT_FOUND'));
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(success(subscriptionRow())),
    });
    vi.mocked(repository.getPlan).mockResolvedValueOnce(failure('INTERNAL_SERVER'));
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('reads the organization row and scopes the invoice to that organization', async () => {
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(success(subscriptionRow())),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await service.getSubscription(managerCtx);

    expect(reads.findSubscription).toHaveBeenCalledWith(managerCtx, false);
    expect(reads.findLatestHostedInvoiceUrl).toHaveBeenCalledWith({
      userId: 'u-9',
      organizationId: 'org-1',
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('does not advertise org actions to a non-admin org manager', async () => {
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(success(subscriptionRow())),
    });
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(managerCtx)).resolves.toMatchObject({
      success: true,
      data: { canManagePortal: false, canChangePlan: false, canCancel: false },
    });
  });

  it('propagates an RLS/read failure', async () => {
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('propagates an invoice lookup failure', async () => {
    reads = createReads({
      findSubscription: vi.fn().mockResolvedValue(success(subscriptionRow())),
      findLatestHostedInvoiceUrl: vi.fn().mockResolvedValue(failure('INTERNAL_SERVER')),
    });
    service = new BillingService(gateway, repository, reads, plans);

    await expect(service.getSubscription(studentCtx)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });
});

describe('BillingService.createPortalSession', () => {
  let gateway: PaymentGateway;
  let repository: StripeBillingRepository;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    repository = createRepository();
    service = new BillingService(gateway, repository, createReads(), createPlans());
  });

  it('returns the account-type-aware local page for the mock driver', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository, createReads(), createPlans());

    const result = await service.createPortalSession(studentCtx, 'pl');

    expect(result).toEqual(success({ url: 'http://localhost:3000/app/billing' }));
    expect(gateway.createPortalSession).toHaveBeenCalledWith({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      returnUrl: 'http://localhost:3000/app/billing',
      locale: 'pl',
    });
    expect(repository.findCustomer).not.toHaveBeenCalled();
    expect(repository.isOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns the educator billing page for an educator', async () => {
    gateway = createGateway('mock');
    service = new BillingService(gateway, repository, createReads(), createPlans());
    const educatorCtx = { ...studentCtx, accountType: AccountType.EDUCATOR };

    await service.createPortalSession(educatorCtx);

    expect(gateway.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: 'http://localhost:3000/edu/billing' }),
    );
  });

  it('never treats a seated educator as an organization owner', async () => {
    const educatorCtx = {
      ...studentCtx,
      accountType: AccountType.EDUCATOR,
      activeOrgId: 'org-1',
    };

    await service.createPortalSession(educatorCtx);

    expect(repository.isOrgAdmin).not.toHaveBeenCalled();
    expect(gateway.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.EDUCATOR },
        returnUrl: 'http://localhost:3000/edu/billing',
      }),
    );
  });

  it('resolves a manager without an organization as a personal owner', async () => {
    const managerWithoutOrg = { ...managerCtx, activeOrgId: null };

    await service.createPortalSession(managerWithoutOrg);

    expect(repository.isOrgAdmin).not.toHaveBeenCalled();
    expect(gateway.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: 'user', userId: 'u-9', accountType: AccountType.MANAGER },
        returnUrl: 'http://localhost:3000/manage/billing',
      }),
    );
  });

  it('re-checks org admin and resolves the organization customer', async () => {
    await service.createPortalSession(managerCtx, 'en');

    expect(repository.isOrgAdmin).toHaveBeenCalledWith('org-1', 'u-9');
    expect(repository.findCustomer).toHaveBeenCalledWith(
      { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      false,
    );
    expect(gateway.createPortalSession).toHaveBeenCalledWith({
      owner: { type: 'org', orgId: 'org-1', userId: 'u-9', accountType: AccountType.MANAGER },
      customerId: 'cus_1',
      returnUrl: 'http://localhost:3000/manage/billing',
      locale: 'en',
    });
  });

  it('refuses a non-admin organization caller without touching Stripe', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(success(false));

    await expect(service.createPortalSession(managerCtx)).resolves.toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
    expect(repository.findCustomer).not.toHaveBeenCalled();
    expect(gateway.createPortalSession).not.toHaveBeenCalled();
  });

  it('propagates an org membership read failure', async () => {
    vi.mocked(repository.isOrgAdmin).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.createPortalSession(managerCtx)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('returns NOT_FOUND when the owner has no Stripe customer mapping', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(success(null));

    await expect(service.createPortalSession(studentCtx)).resolves.toEqual({
      success: false,
      error: 'NOT_FOUND',
    });
    expect(gateway.createPortalSession).not.toHaveBeenCalled();
  });

  it('propagates a customer lookup failure', async () => {
    vi.mocked(repository.findCustomer).mockResolvedValueOnce(failure('INTERNAL_SERVER'));

    await expect(service.createPortalSession(studentCtx)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('resolves the customer mapping in live mode', async () => {
    gateway = { ...createGateway(), livemode: true };
    service = new BillingService(gateway, repository, createReads(), createPlans());

    await service.createPortalSession(studentCtx);

    expect(repository.findCustomer).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('propagates a gateway portal failure', async () => {
    vi.mocked(gateway.createPortalSession).mockResolvedValueOnce(failure('SERVICE_UNAVAILABLE'));

    await expect(service.createPortalSession(studentCtx)).resolves.toEqual({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
    });
  });
});
