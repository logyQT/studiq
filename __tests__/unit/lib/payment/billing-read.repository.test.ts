import { AccountType } from '@studiq/authz';
import type { PaymentOwner } from '@studiq/server/lib/payment/payment-gateway';
import { SupabaseBillingReadRepository } from '@studiq/server/lib/payment/billing-read.repository';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asJson } from '#test/helpers/json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface QueryDouble {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

function createQuery(): QueryDouble {
  const query: QueryDouble = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const method of ['select', 'eq', 'not', 'is', 'order', 'limit'] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

function createClient(query: QueryDouble) {
  return asJson<SupabaseClient<Database>>({
    from: vi.fn().mockReturnValue(query),
  });
}

const userOwner: PaymentOwner = { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT };
const orgOwner: PaymentOwner = {
  type: 'org',
  orgId: 'org-1',
  userId: 'u-9',
  accountType: AccountType.MANAGER,
};

describe('SupabaseBillingReadRepository.findSubscription', () => {
  let query: QueryDouble;
  let repository: SupabaseBillingReadRepository;

  beforeEach(() => {
    query = createQuery();
    repository = new SupabaseBillingReadRepository(() => Promise.resolve(createClient(query)));
  });

  it('scopes an org owner to that organization', async () => {
    query.limit.mockResolvedValueOnce({ data: [], error: null });

    await repository.findSubscription(orgOwner, false);

    expect(query.eq).toHaveBeenCalledWith('livemode', false);
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(query.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
    expect(query.order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('scopes a personal owner to their own row, never the organization', async () => {
    query.limit.mockResolvedValueOnce({ data: [], error: null });

    await repository.findSubscription(userOwner, false);

    expect(query.eq).toHaveBeenCalledWith('user_id', 'u-1');
    expect(query.eq).not.toHaveBeenCalledWith('organization_id', expect.anything());
  });

  it('never re-derives the owner from the caller: the passed owner is the only input', async () => {
    query.limit.mockResolvedValueOnce({ data: [], error: null });

    // An org owner whose user is a "student" persona is still scoped to the org:
    // the persona plays no part once the service resolved the owner.
    await repository.findSubscription(
      { type: 'org', orgId: 'org-2', userId: 'u-1', accountType: AccountType.STUDENT },
      false,
    );

    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-2');
    expect(query.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });

  it('filters by the gateway livemode', async () => {
    query.limit.mockResolvedValueOnce({ data: [], error: null });

    await repository.findSubscription(userOwner, true);

    expect(query.eq).toHaveBeenCalledWith('livemode', true);
  });

  it('prefers a live row over a newer canceled row', async () => {
    query.limit.mockResolvedValueOnce({
      data: [
        {
          stripe_subscription_id: 'sub_old',
          plan_key: 'spark',
          entitlement_applied_plan_key: 'spark',
          status: 'canceled',
          current_period_end: '2026-10-01T00:00:00.000Z',
          cancel_at_period_end: false,
          pending_plan_key: null,
        },
        {
          stripe_subscription_id: 'sub_live',
          plan_key: 'ace',
          entitlement_applied_plan_key: 'ace',
          status: 'past_due',
          current_period_end: '2026-12-01T00:00:00.000Z',
          cancel_at_period_end: false,
          pending_plan_key: 'spark',
        },
      ],
      error: null,
    });

    const result = await repository.findSubscription(userOwner, false);

    expect(result).toEqual({
      success: true,
      data: {
        stripeSubscriptionId: 'sub_live',
        planKey: 'ace',
        entitlementAppliedPlanKey: 'ace',
        status: 'past_due',
        currentPeriodEnd: '2026-12-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        pendingPlanKey: 'spark',
      },
    });
  });

  it('falls back to the most recent row when every row is canceled', async () => {
    query.limit.mockResolvedValueOnce({
      data: [
        {
          stripe_subscription_id: 'sub_newest',
          plan_key: 'spark',
          entitlement_applied_plan_key: 'spark',
          status: 'canceled',
          current_period_end: null,
          cancel_at_period_end: true,
          pending_plan_key: null,
        },
        {
          stripe_subscription_id: 'sub_older',
          plan_key: 'base',
          entitlement_applied_plan_key: 'base',
          status: 'canceled',
          current_period_end: null,
          cancel_at_period_end: false,
          pending_plan_key: null,
        },
      ],
      error: null,
    });

    const result = await repository.findSubscription(userOwner, false);

    expect(result).toMatchObject({
      success: true,
      data: { stripeSubscriptionId: 'sub_newest', cancelAtPeriodEnd: true },
    });
  });

  it('returns null when the caller has no visible row', async () => {
    query.limit.mockResolvedValueOnce({ data: [], error: null });

    await expect(repository.findSubscription(userOwner, false)).resolves.toEqual(successNull());
  });

  it('maps a database error instead of throwing', async () => {
    query.limit.mockResolvedValueOnce({ data: null, error: { code: '42501' } });

    const result = await repository.findSubscription(userOwner, false);

    expect(result.success).toBe(false);
  });
});

describe('SupabaseBillingReadRepository.findLatestHostedInvoiceUrl', () => {
  let query: QueryDouble;
  let repository: SupabaseBillingReadRepository;

  beforeEach(() => {
    query = createQuery();
    repository = new SupabaseBillingReadRepository(() => Promise.resolve(createClient(query)));
  });

  it('scopes a personal invoice to the caller, subscription and mode-independent owner', async () => {
    query.maybeSingle.mockResolvedValueOnce({
      data: { hosted_invoice_url: 'https://invoice.stripe.com/i/1' },
      error: null,
    });

    const result = await repository.findLatestHostedInvoiceUrl({
      userId: 'u-1',
      organizationId: null,
      stripeSubscriptionId: 'sub_1',
    });

    expect(result).toEqual(successUrl('https://invoice.stripe.com/i/1'));
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u-1');
    expect(query.eq).toHaveBeenCalledWith('provider', 'stripe');
    expect(query.eq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_1');
    expect(query.is).toHaveBeenCalledWith('organization_id', null);
    expect(query.not).toHaveBeenCalledWith('hosted_invoice_url', 'is', null);
    expect(query.order).toHaveBeenCalledWith('paid_at', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it('scopes an organization invoice to that organization', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await repository.findLatestHostedInvoiceUrl({
      userId: 'u-9',
      organizationId: 'org-1',
      stripeSubscriptionId: 'sub_org',
    });

    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(query.is).not.toHaveBeenCalled();
  });

  it('returns null when there is no hosted invoice', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      repository.findLatestHostedInvoiceUrl({
        userId: 'u-1',
        organizationId: null,
        stripeSubscriptionId: 'sub_1',
      }),
    ).resolves.toEqual(successNull());
  });

  it('maps a database error instead of throwing', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42501' } });

    const result = await repository.findLatestHostedInvoiceUrl({
      userId: 'u-1',
      organizationId: null,
      stripeSubscriptionId: 'sub_1',
    });

    expect(result.success).toBe(false);
  });
});

function successNull() {
  return { success: true, data: null };
}

function successUrl(url: string) {
  return { success: true, data: url };
}
