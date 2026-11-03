// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import Stripe from 'stripe';

/**
 * The one place that pins the Stripe API version (#662 X4). Never let the SDK
 * default change silently: payload shapes (e.g. period dates moving into
 * `subscription.items.data[]`) change between versions.
 */
export const STRIPE_API_VERSION = '2026-10-28.endive' as const;

export interface StripeRequestOptions {
  idempotencyKey?: string;
}

/**
 * Narrow surface of the Stripe SDK used by `StripePaymentGateway`.
 *
 * Keeping the interface small means unit tests inject a plain fake and never
 * touch the network. Later phases add the portal, schedules and webhook
 * verification helpers here as they are implemented.
 */
export interface StripeClient {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options?: StripeRequestOptions,
    ): Promise<Stripe.Customer>;
  };
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: StripeRequestOptions,
      ): Promise<Stripe.Checkout.Session>;
      retrieve(
        id: string,
        params?: Stripe.Checkout.SessionRetrieveParams,
        options?: StripeRequestOptions,
      ): Promise<Stripe.Checkout.Session>;
    };
  };
  prices: {
    retrieve(
      id: string,
      params?: Stripe.PriceRetrieveParams,
      options?: StripeRequestOptions,
    ): Promise<Stripe.Price>;
  };
  subscriptions: {
    retrieve(
      id: string,
      params?: Stripe.SubscriptionRetrieveParams,
      options?: StripeRequestOptions,
    ): Promise<Stripe.Subscription>;
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: StripeRequestOptions,
    ): Promise<Stripe.Subscription>;
  };
  subscriptionSchedules: {
    create(
      params: Stripe.SubscriptionScheduleCreateParams,
      options?: StripeRequestOptions,
    ): Promise<Stripe.SubscriptionSchedule>;
    update(
      id: string,
      params: Stripe.SubscriptionScheduleUpdateParams,
      options?: StripeRequestOptions,
    ): Promise<Stripe.SubscriptionSchedule>;
    release(id: string): Promise<Stripe.SubscriptionSchedule>;
  };
  billingPortal: {
    sessions: {
      create(
        params: Stripe.BillingPortal.SessionCreateParams,
        options?: StripeRequestOptions,
      ): Promise<Stripe.BillingPortal.Session>;
    };
  };
  webhooks: {
    constructEvent(
      payload: string | Uint8Array,
      header: string | string[] | Uint8Array,
      secret: string,
      tolerance?: number,
    ): Stripe.Event;
  };
}

/**
 * Real client. `apiVersion` is pinned in code, so a dependency bump cannot
 * change request/response semantics unnoticed.
 */
export function createStripeClient(secretKey: string): StripeClient {
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

  return {
    customers: {
      create: (params, options) => stripe.customers.create(params, options),
    },
    checkout: {
      sessions: {
        create: (params, options) => stripe.checkout.sessions.create(params, options),
        retrieve: (id, params, options) => stripe.checkout.sessions.retrieve(id, params, options),
      },
    },
    prices: {
      retrieve: (id, params, options) => stripe.prices.retrieve(id, params, options),
    },
    subscriptions: {
      retrieve: (id, params, options) => stripe.subscriptions.retrieve(id, params, options),
      update: (id, params, options) => stripe.subscriptions.update(id, params, options),
    },
    subscriptionSchedules: {
      create: (params, options) => stripe.subscriptionSchedules.create(params, options),
      update: (id, params, options) => stripe.subscriptionSchedules.update(id, params, options),
      release: (id) => stripe.subscriptionSchedules.release(id),
    },
    billingPortal: {
      sessions: {
        create: (params, options) => stripe.billingPortal.sessions.create(params, options),
      },
    },
    webhooks: {
      constructEvent: (payload, header, secret, tolerance) =>
        stripe.webhooks.constructEvent(payload, header, secret, tolerance),
    },
  };
}
