import { isOrgAdminRole } from '@studiq/authz';
import type { BillingCycle, PaymentOwner } from '@studiq/server/lib/payment/payment-gateway';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role persistence used by the checkout path (#662 phase 2A).
 *
 * Everything here is provider/config data that must never reach the client:
 * Stripe customer ids, the price map and the subscription mirror. Reads never
 * trust a request body — the owner is always the one resolved by
 * `BillingService`.
 */
export interface CatalogPlan {
  key: string;
  name: string;
  priceMonthly: number;
  currency: string;
  isActive: boolean;
  forAccountType: string | null;
}

export interface CustomerMapping {
  stripeCustomerId: string;
}

export interface CustomerDetails {
  email: string;
  name: string;
}

export interface ListedPrice {
  planKey: string;
  stripePriceId: string;
  currency: string;
  unitAmount: number;
  interval: string;
  active: boolean;
}

export interface ActiveSubscription {
  stripeSubscriptionId: string;
  status: string;
}

/** Minimal plan shape needed to validate a mapped Price. */
export interface PlanPricing {
  key: string;
  priceMonthly: number;
  currency: string;
}

export type PriceValidationError =
  'missing' | 'inactive' | 'plan' | 'currency' | 'amount' | 'interval';

/**
 * Fails closed unless the mapped Price still charges exactly the catalog
 * amount in the catalog currency, monthly. A Dashboard edit or a stale row must
 * never create a session with a different amount (#662 §9.3).
 */
export function validateListedPrice(
  plan: PlanPricing,
  price: ListedPrice | null,
): PriceValidationError | null {
  if (!price) return 'missing';
  if (!price.active) return 'inactive';
  if (price.planKey !== plan.key) return 'plan';
  if (price.currency.toUpperCase() !== plan.currency.toUpperCase()) return 'currency';
  if (price.unitAmount !== plan.priceMonthly) return 'amount';
  if (price.interval !== 'month') return 'interval';
  return null;
}

export interface StripeBillingRepository {
  getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>>;
  isOrgAdmin(orgId: string, userId: string): Promise<ServiceResult<boolean>>;
  findCustomer(
    owner: PaymentOwner,
    livemode: boolean,
  ): Promise<ServiceResult<CustomerMapping | null>>;
  insertCustomer(
    owner: PaymentOwner,
    stripeCustomerId: string,
    livemode: boolean,
  ): Promise<ServiceResult<CustomerMapping>>;
  getCustomerDetails(owner: PaymentOwner): Promise<ServiceResult<CustomerDetails>>;
  findPriceById(priceId: string, livemode: boolean): Promise<ServiceResult<ListedPrice | null>>;
  findListedPrice(
    planKey: string,
    billingCycle: BillingCycle,
    livemode: boolean,
  ): Promise<ServiceResult<ListedPrice | null>>;
  findActiveSubscription(
    owner: PaymentOwner,
    livemode: boolean,
  ): Promise<ServiceResult<ActiveSubscription | null>>;
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

function mapPrice(row: Record<string, unknown>): ListedPrice {
  return {
    planKey: row.plan_key as string,
    stripePriceId: row.stripe_price_id as string,
    currency: row.currency as string,
    unitAmount: row.unit_amount as number,
    interval: row.interval as string,
    active: row.active as boolean,
  };
}

export class SupabaseStripeBillingRepository implements StripeBillingRepository {
  constructor(private readonly createAdminClient: () => SupabaseClient = createServiceClient) {}

  async getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('key, name, price_monthly, currency, is_active, for_account_type')
      .eq('key', planKey)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({
      key: data.key as string,
      name: (data.name as string | null) ?? (data.key as string),
      priceMonthly: (data.price_monthly as number | null) ?? 0,
      currency: (data.currency as string | null) ?? 'PLN',
      isActive: (data.is_active as boolean | null) ?? true,
      forAccountType: (data.for_account_type as string | null) ?? null,
    });
  }

  async isOrgAdmin(orgId: string, userId: string): Promise<ServiceResult<boolean>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('org_members')
      .select('org_roles!inner(name)')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return toDbFailure(error);

    const role = data?.org_roles as { name?: string } | { name?: string }[] | undefined;
    const roleName = Array.isArray(role) ? role[0]?.name : role?.name;
    return success(isOrgAdminRole(roleName));
  }

  async findCustomer(
    owner: PaymentOwner,
    livemode: boolean,
  ): Promise<ServiceResult<CustomerMapping | null>> {
    const supabase = this.createAdminClient();
    const base = supabase
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('livemode', livemode);

    const { data, error } = await (
      owner.type === 'user'
        ? base.eq('user_id', owner.userId)
        : base.eq('organization_id', owner.orgId)
    ).maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({ stripeCustomerId: data.stripe_customer_id as string });
  }

  async insertCustomer(
    owner: PaymentOwner,
    stripeCustomerId: string,
    livemode: boolean,
  ): Promise<ServiceResult<CustomerMapping>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('billing_customers')
      .insert({
        user_id: owner.type === 'user' ? owner.userId : null,
        organization_id: owner.type === 'org' ? owner.orgId : null,
        stripe_customer_id: stripeCustomerId,
        livemode,
      })
      .select('stripe_customer_id')
      .single();

    if (error) {
      // Two concurrent checkouts can both create a Stripe customer. The unique
      // index resolves the race: keep the first mapping instead of failing the
      // second request.
      if (error.code === '23505') {
        const existing = await this.findCustomer(owner, livemode);
        if (existing.success && existing.data) return success(existing.data);
      }
      return toDbFailure(error);
    }

    return success({ stripeCustomerId: data.stripe_customer_id as string });
  }

  async getCustomerDetails(owner: PaymentOwner): Promise<ServiceResult<CustomerDetails>> {
    const supabase = this.createAdminClient();

    if (owner.type === 'user') {
      const { data, error } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', owner.userId)
        .maybeSingle();

      if (error) return toDbFailure(error);
      if (!data?.email) return failure('NOT_FOUND');

      return success({
        email: data.email as string,
        name: (data.full_name as string | null)?.trim() || (data.email as string),
      });
    }

    const [orgResult, purchaserResult] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', owner.orgId).maybeSingle(),
      supabase.from('profiles').select('email').eq('id', owner.userId).maybeSingle(),
    ]);

    if (orgResult.error) return toDbFailure(orgResult.error);
    if (purchaserResult.error) return toDbFailure(purchaserResult.error);
    if (!orgResult.data || !purchaserResult.data?.email) return failure('NOT_FOUND');

    return success({
      email: purchaserResult.data.email as string,
      name: orgResult.data.name as string,
    });
  }

  async findPriceById(
    priceId: string,
    livemode: boolean,
  ): Promise<ServiceResult<ListedPrice | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('stripe_prices')
      .select('plan_key, stripe_price_id, currency, unit_amount, interval, active')
      .eq('stripe_price_id', priceId)
      .eq('livemode', livemode)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data ? mapPrice(data) : null);
  }

  async findListedPrice(
    planKey: string,
    billingCycle: BillingCycle,
    livemode: boolean,
  ): Promise<ServiceResult<ListedPrice | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('stripe_prices')
      .select('plan_key, stripe_price_id, currency, unit_amount, interval, active')
      .eq('plan_key', planKey)
      .eq('billing_cycle', billingCycle)
      .eq('livemode', livemode)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data ? mapPrice(data) : null);
  }

  async findActiveSubscription(
    owner: PaymentOwner,
    livemode: boolean,
  ): Promise<ServiceResult<ActiveSubscription | null>> {
    const supabase = this.createAdminClient();
    const base = supabase
      .from('billing_subscriptions')
      .select('stripe_subscription_id, status')
      .eq('livemode', livemode)
      .in('status', ACTIVE_SUBSCRIPTION_STATUSES);

    const { data, error } = await (
      owner.type === 'user'
        ? base.eq('user_id', owner.userId)
        : base.eq('organization_id', owner.orgId)
    ).maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({
      stripeSubscriptionId: data.stripe_subscription_id as string,
      status: data.status as string,
    });
  }
}

export const stripeBillingRepository = new SupabaseStripeBillingRepository();
