// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import type Stripe from 'stripe';
import { AppError } from '@studiq/server/lib/errors';
import { error as logError, log, warn as logWarn } from '@studiq/server/lib/log';
import { isRecord, readString } from '@studiq/server/lib/record';
import type { WebhookOutcome } from '@studiq/server/lib/payment/payment-gateway';
import { STRIPE_API_VERSION, type StripeClient } from '@studiq/server/lib/payment/stripe-client';
import type { CatalogPlan } from '@studiq/server/lib/payment/stripe-repository';
import {
  type CustomerRow,
  type StripeWebhookRepository,
  type SubscriptionMirror,
  stripeWebhookRepository,
} from '@studiq/server/lib/payment/stripe-webhook.repository';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import {
  type EntitlementApplyOutcome,
  type EntitlementFence,
  type EntitlementOwner,
  type EntitlementService,
  entitlementService,
} from '@studiq/server/services/entitlement.service';

/**
 * Stripe webhook handling (#662 §6).
 *
 * Contract:
 *
 * 1. verify the raw body against `stripe-signature` — never `req.json()` first;
 * 2. reject a `livemode` that disagrees with the configured key;
 * 3. claim `event.id` in `stripe_webhook_events` before any side effect;
 * 4. re-fetch the subscription and apply its **current** snapshot, so an
 *    out-of-order delivery can never regress a plan;
 * 5. `invoice.paid` is the only writer of Stripe `payments` rows.
 *
 * Everything the handler writes is absolute (`plan = X`, `status = Y`) and the
 * invoice id is unique, so even a retry that slips past the event table cannot
 * double-write.
 */

const METADATA_OWNER_TYPE = 'studiq_owner_type';
const METADATA_USER_ID = 'studiq_user_id';
const METADATA_ORG_ID = 'studiq_org_id';
const METADATA_PLAN_KEY = 'studiq_plan_key';

const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);
const DOWNGRADE_STATUSES = new Set(['unpaid', 'canceled', 'incomplete_expired', 'paused']);
const DUPLICATE_GUARD_STATUSES = new Set(['active', 'trialing', 'past_due']);

export interface StripeWebhookServiceOptions {
  client: StripeClient;
  webhookSecret: string;
  livemode: boolean;
  repository?: StripeWebhookRepository;
  entitlements?: Pick<EntitlementService, 'applyPlanFenced' | 'downgradeToFreeFenced'>;
  now?: () => Date;
}

interface ResolvedOwner {
  owner: EntitlementOwner;
  purchaserUserId: string | null;
}

interface ResolvedPlan {
  plan: CatalogPlan;
  priceId: string;
}

interface DispatchResult {
  ignored: boolean;
  /**
   * A newer event already owns the subscription mirror. The mirror/entitlement
   * writes were skipped, but non-mirror side effects (e.g. the `payments` row
   * for `invoice.paid`) must still happen.
   */
  stale?: boolean;
  /** True only when this call actually applied a plan entitlement. */
  entitlementApplied?: boolean;
}

function objectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function secondsToIso(value: number | null | undefined): string | null {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : null;
}

/** Period dates live on `subscription.items.data[]` since API 2025-03-31.basil. */
function periodDates(subscription: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const items = dbRows(subscription.items.data);
  const starts = items
    .map((item) => item.current_period_start)
    .filter((value): value is number => typeof value === 'number');
  const ends = items
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number');

  return {
    start: secondsToIso(starts.length > 0 ? Math.min(...starts) : null),
    end: secondsToIso(ends.length > 0 ? Math.max(...ends) : null),
  };
}

function firstPriceId(subscription: Stripe.Subscription): string | null {
  return dbRows(subscription.items.data).at(0)?.price.id ?? null;
}

/** `invoice.parent.subscription_details` replaced top-level `invoice.subscription`. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  const parentId = objectId(fromParent);
  if (parentId) return parentId;

  for (const line of dbRows(invoice.lines.data)) {
    const subscriptionId = line.parent?.subscription_item_details?.subscription;
    if (subscriptionId) return subscriptionId;
  }

  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function isResourceMissing(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = readString(error, 'code');
  const type = readString(error, 'type');
  return code === 'resource_missing' || type === 'StripeInvalidRequestError';
}

/*
 * Stripe types `Event.data.object` as an empty interface because the payload
 * shape depends on `event.type`. These helpers are the single boundary that
 * trusts the event type's discrimination.
 */
function checkoutSession(event: Stripe.Event): Stripe.Checkout.Session {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stripe-node leaves data.object untyped; the event type discriminates it.
  return event.data.object as Stripe.Checkout.Session;
}

function subscriptionPayload(event: Stripe.Event): Stripe.Subscription {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stripe-node leaves data.object untyped; the event type discriminates it.
  return event.data.object as Stripe.Subscription;
}

function invoicePayload(event: Stripe.Event): Stripe.Invoice {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stripe-node leaves data.object untyped; the event type discriminates it.
  return event.data.object as Stripe.Invoice;
}

/**
 * Deliberately has no module-level singleton: it depends on boot-validated
 * options (Stripe client, webhook secret, livemode) and is constructed lazily
 * by `StripePaymentGateway.webhookService()`, which wraps it with `wrapService`
 * (`stripe-webhook.service`). Importing this module must not require Stripe
 * configuration; a singleton export would run that check at import time.
 */
export class StripeWebhookService {
  private readonly client: StripeClient;
  private readonly webhookSecret: string;
  private readonly livemode: boolean;
  private readonly repository: StripeWebhookRepository;
  private readonly entitlements: Pick<
    EntitlementService,
    'applyPlanFenced' | 'downgradeToFreeFenced'
  >;
  private readonly now: () => Date;

  constructor(options: StripeWebhookServiceOptions) {
    this.client = options.client;
    this.webhookSecret = options.webhookSecret;
    this.livemode = options.livemode;
    this.repository = options.repository ?? stripeWebhookRepository;
    this.entitlements = options.entitlements ?? entitlementService;
    this.now = options.now ?? (() => new Date());
  }

  async handle(rawBody: string, signature: string | null): Promise<ServiceResult<WebhookOutcome>> {
    if (!signature) {
      logWarn('billing.webhook_signature_missing');
      return failure('BAD_REQUEST');
    }

    let event: Stripe.Event;
    try {
      // Default tolerance is 300 s on purpose (#662 §9.1): a tighter window
      // turns a slow delivery into a permanent failure.
      event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      // Never log the payload or the signature: it contains customer data and a
      // replayable proof.
      logWarn('billing.webhook_signature_invalid', { message: errorMessage(error) });
      return failure('BAD_REQUEST');
    }

    if (event.livemode !== this.livemode) {
      logError('billing.webhook_livemode_mismatch', {
        eventId: event.id,
        type: event.type,
        eventLivemode: event.livemode,
        expectedLivemode: this.livemode,
      });
      return failure('BAD_REQUEST');
    }

    if (event.api_version && event.api_version !== STRIPE_API_VERSION) {
      logWarn('billing.webhook_api_version_mismatch', {
        eventId: event.id,
        type: event.type,
        apiVersion: event.api_version,
        expected: STRIPE_API_VERSION,
      });
    }

    const claim = await this.repository.claimEvent({
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      apiVersion: event.api_version,
      eventCreated: event.created,
    });
    if (isFailure(claim)) return claim;

    if (claim.data.outcome === 'busy') {
      // Another delivery still owns a live processing lease. Returning 200 here
      // would let Stripe stop retrying while that worker may fail.
      logWarn('billing.webhook_processing_lease_active', {
        eventId: event.id,
        type: event.type,
      });
      return failure('SERVICE_UNAVAILABLE');
    }

    if (claim.data.outcome === 'duplicate') {
      log('billing.webhook_duplicate', { eventId: event.id, type: event.type });
      return success({ received: true, duplicate: true });
    }

    // The claim token fences completion: if another delivery reclaimed this row
    // (lease expired), the older attempt must not close it.
    const claimToken = claim.data.receivedAt ?? '';

    try {
      const result = await this.dispatch(event, claimToken);
      await this.finish(event, claimToken, result.ignored);
      return success({ received: true, ...(result.ignored ? { ignored: true } : {}) });
    } catch (error) {
      // A 5xx makes Stripe retry; `failed` lets the next attempt re-run.
      await this.markFailed(event, claimToken, errorMessage(error));
      logError('billing.webhook_failed', {
        eventId: event.id,
        type: event.type,
        message: errorMessage(error),
      });
      return failure('INTERNAL_SERVER');
    }
  }

  private async dispatch(event: Stripe.Event, claimToken: string): Promise<DispatchResult> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event, claimToken);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionChanged(event, false, claimToken);
      case 'customer.subscription.deleted':
        return this.onSubscriptionChanged(event, true, claimToken);
      case 'invoice.paid':
        return this.onInvoicePaid(event, claimToken);
      case 'invoice.payment_failed':
        return this.onInvoicePaymentProblem(event, false, claimToken);
      case 'invoice.payment_action_required':
        return this.onInvoicePaymentProblem(event, true, claimToken);
      case 'checkout.session.expired': {
        const session = checkoutSession(event);
        log('billing.checkout_expired', { eventId: event.id, sessionId: session.id });
        return { ignored: true };
      }
      default:
        log('billing.webhook_ignored', { eventId: event.id, type: event.type });
        return { ignored: true };
    }
  }

  private async onCheckoutCompleted(
    event: Stripe.Event,
    claimToken: string,
  ): Promise<DispatchResult> {
    return this.activateCheckoutSession(checkoutSession(event), {
      eventId: event.id,
      eventCreated: event.created,
      claimToken,
    });
  }

  /**
   * Shared by `checkout.session.completed` and the authenticated reconcile
   * endpoint (#662 X6). It re-uses the exact same customer/subscription/plan
   * rules; only the freshness/fencing source differs.
   */
  private async activateCheckoutSession(
    session: Stripe.Checkout.Session,
    source: { eventId: string | null; eventCreated: number | null; claimToken: string | null },
  ): Promise<DispatchResult> {
    const metadataOwner = this.ownerFromMetadata(session.metadata);
    if (!metadataOwner) {
      logError('billing.owner_unresolved', {
        eventId: source.eventId,
        objectId: session.id,
        object: 'checkout.session',
      });
      return { ignored: true };
    }

    const customerId = objectId(session.customer);
    if (customerId) {
      const customer = await this.ensureCustomer(customerId, metadataOwner);
      if (isFailure(customer)) throw new Error('customer mapping failed');
    }

    const subscriptionId = objectId(session.subscription);
    if (!subscriptionId) {
      log('billing.checkout_without_subscription', {
        eventId: source.eventId,
        sessionId: session.id,
      });
      return { ignored: true };
    }

    // Read the mirror *before* retrieving the subscription. Its generation is
    // the write-order tiebreaker for same-second events, and a webhook that
    // wins the race after this read makes the CAS below reject our older
    // snapshot, so reconcile can never rewind a newer plan.
    const existing = await this.repository.getSubscriptionByStripeId(subscriptionId);
    if (isFailure(existing)) throw new Error('subscription mirror read failed');
    const mirror = existing.data;
    let eventCreated = source.eventCreated;
    if (eventCreated === null) eventCreated = mirror?.lastEventCreated ?? 0;

    const subscription = await this.retrieveSubscription(subscriptionId, null);
    if (!subscription) {
      logError('billing.subscription_unresolved', {
        eventId: source.eventId,
        subscriptionId,
        object: 'checkout.session',
      });
      return { ignored: true };
    }

    const resolved = await this.resolvePlan(subscription, session.metadata, metadataOwner);
    if (!resolved) {
      logError('billing.price_unmapped', { eventId: source.eventId, subscriptionId });
      return { ignored: true };
    }

    const paid =
      session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    // A webhook may downgrade from a `canceled` checkout snapshot; reconcile is
    // **activate-only**, so a historical success URL can never wipe a newer or
    // manually comped entitlement.
    const applyEntitlement =
      paid && (source.eventId !== null || ENTITLED_STATUSES.has(subscription.status));

    const applied = await this.syncSubscription({
      eventId: source.eventId,
      eventCreated,
      claimToken: source.claimToken,
      subscription,
      owner: metadataOwner,
      resolved,
      mirror,
      expectedGeneration: mirror?.snapshotGeneration ?? 0,
      checkoutSessionId: session.id,
      applyEntitlement,
    });

    if (applied.ignored) return applied;

    // `checkout.session.completed` never writes a payments row: `invoice.paid`
    // owns the history, so the first charge is not duplicated (§6.3).
    return applied;
  }

  /**
   * Authenticated reconcile (#662 X6). The gateway has already verified that
   * the session belongs to the caller and is paid; this reuses the idempotent
   * activation path without an event-table signature/claim.
   */
  async reconcileCheckout(
    session: Stripe.Checkout.Session,
  ): Promise<ServiceResult<{ activated: boolean }>> {
    // Defense in depth: the gateway already requires a paid session, but the
    // activation path must never grant an entitlement from an unpaid session.
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return success({ activated: false });
    }

    try {
      const result = await this.activateCheckoutSession(session, {
        eventId: null,
        eventCreated: null,
        claimToken: null,
      });

      // `stale` means a newer webhook already wrote this subscription; report
      // it as activated. Otherwise only a real entitlement write counts — an
      // activate-only reconcile must not claim a canceled/incomplete session
      // activated anything.
      return success({
        activated: result.entitlementApplied === true || result.stale === true,
      });
    } catch (error) {
      logError('billing.reconcile_failed', {
        sessionId: session.id,
        message: errorMessage(error),
      });
      return failure('SERVICE_UNAVAILABLE');
    }
  }

  private async onSubscriptionChanged(
    event: Stripe.Event,
    deleted: boolean,
    claimToken: string,
  ): Promise<DispatchResult> {
    const payload = subscriptionPayload(event);

    // Read the mirror *before* retrieving the provider snapshot. Its generation
    // is the write-order tiebreaker for same-second events: a concurrent writer
    // bumps it and our upsert reports `conflict` instead of overwriting a
    // fresher snapshot.
    const mirror = await this.repository.getSubscriptionByStripeId(payload.id);
    if (isFailure(mirror)) throw new Error('subscription mirror read failed');

    if (mirror.data && event.created < mirror.data.lastEventCreated) {
      // The mirror already reflects a newer event. Re-applying this older
      // snapshot could regress the plan, so skip the entitlement entirely.
      log('billing.webhook_out_of_order', {
        eventId: event.id,
        subscriptionId: payload.id,
        eventCreated: event.created,
        lastEventCreated: mirror.data.lastEventCreated,
      });
      return { ignored: true };
    }

    const subscription = await this.retrieveSubscription(payload.id, deleted ? payload : null);
    if (!subscription) {
      logError('billing.subscription_unresolved', {
        eventId: event.id,
        subscriptionId: payload.id,
        object: 'subscription',
      });
      return { ignored: true };
    }

    const owner =
      this.ownerFromMirror(mirror.data) ??
      this.ownerFromMetadata(subscription.metadata) ??
      (objectId(subscription.customer)
        ? await this.ownerFromCustomer(objectId(subscription.customer)!)
        : null);
    if (!owner) {
      logError('billing.owner_unresolved', {
        eventId: event.id,
        objectId: subscription.id,
        object: 'subscription',
      });
      return { ignored: true };
    }

    const resolved = await this.resolvePlan(subscription, subscription.metadata, owner, {
      // Cancellation cleanup must not depend on the plan still being sellable.
      // A deleted event only downgrades, so a retired catalog row is enough to
      // pick the free-plan family; it can never re-apply the paid plan here.
      allowInactive: deleted,
    });
    if (!resolved) {
      logError('billing.price_unmapped', { eventId: event.id, subscriptionId: subscription.id });
      return { ignored: true };
    }
    if (deleted && !resolved.plan.isActive) {
      log('billing.plan_retired_cancellation', {
        eventId: event.id,
        subscriptionId: subscription.id,
        planKey: resolved.plan.key,
      });
    }

    return this.syncSubscription({
      eventId: event.id,
      eventCreated: event.created,
      claimToken,
      subscription,
      owner,
      resolved,
      mirror: mirror.data,
      expectedGeneration: mirror.data?.snapshotGeneration ?? 0,
      checkoutSessionId: mirror.data?.checkoutSessionId ?? null,
      applyEntitlement: true,
      forceDowngrade: deleted,
    });
  }

  /**
   * Upsert the mirror and apply the entitlement for the subscription's current
   * state. Shared by checkout/subscription events so every path re-fetches and
   * writes the same absolute snapshot.
   */
  private async syncSubscription(input: {
    /** `null` for the authenticated reconcile path (no event row). */
    eventId: string | null;
    /** Event timestamp, or the mirror's freshness value for reconcile. */
    eventCreated: number;
    claimToken: string | null;
    subscription: Stripe.Subscription;
    owner: ResolvedOwner;
    resolved: ResolvedPlan;
    mirror?: SubscriptionMirror | null;
    /** Generation read before the provider snapshot was retrieved. */
    expectedGeneration: number;
    checkoutSessionId: string | null;
    applyEntitlement: boolean;
    forceDowngrade?: boolean;
  }): Promise<DispatchResult> {
    const { subscription, owner, resolved } = input;
    const status = subscription.status;

    // Fence the writes, not only the event completion: if this attempt lost the
    // claim lease to a retry while it was stalled, its snapshot may be older
    // than the one the retry already applied. Do not write it. Reconcile has no
    // claim row, so it skips this fence (freshness CAS still applies).
    if (input.claimToken) {
      if (!input.eventId) throw new Error('missing event id for fenced write');
      if (!(await this.ensureClaimOwner(input.eventId, input.claimToken))) {
        logWarn('billing.webhook_claim_lost', {
          eventId: input.eventId,
          subscriptionId: subscription.id,
          phase: 'subscription',
        });
        return { ignored: true };
      }
    }

    // §5.5 / §6.3: never replace an already-active subscription with a second
    // one. Two successful checkouts are a manual refund, not an entitlement.
    if (DUPLICATE_GUARD_STATUSES.has(status)) {
      const active = await this.repository.findActiveSubscription(owner.owner, this.livemode);
      if (isFailure(active)) throw new Error('active subscription read failed');

      if (active.data && active.data.stripeSubscriptionId !== subscription.id) {
        logError('billing.duplicate_subscription', {
          subscriptionId: subscription.id,
          activeSubscriptionId: active.data.stripeSubscriptionId,
          ownerType: owner.owner.type,
        });
        return { ignored: true };
      }
    }

    const customerId = objectId(subscription.customer);
    if (!customerId) {
      logError('billing.owner_unresolved', {
        eventId: input.eventId,
        objectId: subscription.id,
        object: 'subscription',
      });
      return { ignored: true };
    }

    const customer = await this.ensureCustomer(customerId, owner);
    if (isFailure(customer)) throw new Error('customer mapping failed');

    const period = periodDates(subscription);
    const upsert = await this.repository.upsertSubscription({
      stripeSubscriptionId: subscription.id,
      billingCustomerId: customer.data.id,
      userId: owner.owner.type === 'user' ? owner.owner.userId : null,
      organizationId: owner.owner.type === 'org' ? owner.owner.orgId : null,
      purchaserUserId: owner.purchaserUserId,
      checkoutSessionId: input.checkoutSessionId,
      planKey: resolved.plan.key,
      priceId: resolved.priceId,
      status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: secondsToIso(subscription.cancel_at),
      canceledAt: secondsToIso(subscription.canceled_at),
      lastEventCreated: Math.max(input.mirror?.lastEventCreated ?? 0, input.eventCreated),
      eventCreated: input.eventCreated,
      expectedGeneration: input.expectedGeneration,
      livemode: this.livemode,
    });

    if (isFailure(upsert)) {
      // The one-active-subscription partial index is the last line of defence
      // for a concurrent duplicate; treat it like the guard above.
      if (upsert.error === 'CONFLICT') {
        logError('billing.duplicate_subscription', {
          subscriptionId: subscription.id,
          ownerType: owner.owner.type,
        });
        return { ignored: true };
      }
      throw new Error('subscription mirror write failed');
    }

    if (upsert.data.outcome === 'stale') {
      // A newer event already wrote this subscription. Do not apply our older
      // snapshot; still record the checkout session id if the winner lacked it.
      log('billing.webhook_stale_subscription', {
        eventId: input.eventId,
        subscriptionId: subscription.id,
        eventCreated: input.eventCreated,
      });
      if (input.checkoutSessionId) {
        const attached = await this.repository.attachCheckoutSession(
          subscription.id,
          input.checkoutSessionId,
        );
        if (isFailure(attached)) throw new Error('checkout session attach failed');
      }
      return { ignored: true, stale: true };
    }

    if (upsert.data.outcome === 'conflict') {
      // A concurrent writer changed the mirror after we read its generation.
      // This attempt may carry an older same-second snapshot, so never apply
      // it. Throwing makes the delivery retryable: the retry re-reads the
      // mirror and the provider snapshot, so a cancellation is not dropped.
      logWarn('billing.webhook_snapshot_conflict', {
        eventId: input.eventId,
        subscriptionId: subscription.id,
        expectedGeneration: input.expectedGeneration,
      });
      throw new Error('subscription snapshot conflict');
    }

    const snapshotGeneration = upsert.data.generation;
    if (snapshotGeneration === null) throw new Error('missing snapshot generation');

    if (input.applyEntitlement) {
      // Re-read immediately before the entitlement write. If a newer event won
      // while this attempt was parsing, its plan must stand.
      const latest = await this.repository.getSubscriptionByStripeId(subscription.id);
      if (isFailure(latest)) throw new Error('subscription mirror read failed');
      if (latest.data && latest.data.lastEventCreated > input.eventCreated) {
        log('billing.webhook_stale_subscription', {
          eventId: input.eventId,
          subscriptionId: subscription.id,
          eventCreated: input.eventCreated,
          lastEventCreated: latest.data.lastEventCreated,
        });
        return { ignored: true, stale: true };
      }

      const entitlement = await this.applyEntitlement(
        owner.owner,
        resolved,
        status,
        {
          stripeSubscriptionId: subscription.id,
          eventCreated: input.eventCreated,
          snapshotGeneration,
        },
        input.forceDowngrade,
      );
      if (isFailure(entitlement)) throw new Error('entitlement write failed');
      if (entitlement.data === 'stale') {
        // The database fence lost to a newer snapshot after the read above:
        // the newer event owns the entitlement now.
        log('billing.webhook_stale_subscription', {
          eventId: input.eventId,
          subscriptionId: subscription.id,
          eventCreated: input.eventCreated,
          phase: 'entitlement',
        });
        return { ignored: true, stale: true };
      }

      // The pending marker is display-only and now describes the applied plan
      // (a scheduled downgrade reached its phase, or the upgrade price landed).
      // A terminal status / a subscription with no schedule or pending update
      // cannot still carry a meaningful marker, so clear it outright; when the
      // provider still shows a pending change, clear conditionally so a newer
      // target is not discarded. This write deliberately does not touch
      // `last_event_created`.
      const terminal = Boolean(input.forceDowngrade) || DOWNGRADE_STATUSES.has(status);
      const entitlementWasWritten = terminal || ENTITLED_STATUSES.has(status);
      const providerStillPending =
        Boolean(subscription.schedule) || Boolean(subscription.pending_update);
      const cleared = !entitlementWasWritten
        ? success(undefined)
        : terminal || !providerStillPending
          ? await this.repository.clearPendingPlan(subscription.id)
          : await this.repository.clearPendingPlanIfApplied(subscription.id, resolved.plan.key);
      if (isFailure(cleared)) {
        // The entitlement already landed; a marker cleanup failure must not
        // turn a successful event into a retry.
        logWarn('billing.pending_plan_clear_failed', {
          eventId: input.eventId,
          subscriptionId: subscription.id,
        });
      }

      return { ignored: false, entitlementApplied: true };
    }

    return { ignored: false };
  }

  private async onInvoicePaid(event: Stripe.Event, claimToken: string): Promise<DispatchResult> {
    const invoice = invoicePayload(event);
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) {
      log('billing.invoice_without_subscription', { eventId: event.id, invoiceId: invoice.id });
      return { ignored: true };
    }

    // Read the mirror before the provider snapshot so its generation fences a
    // same-second concurrent write (see `onSubscriptionChanged`).
    const mirrorResult = await this.repository.getSubscriptionByStripeId(subscriptionId);
    if (isFailure(mirrorResult)) throw new Error('subscription mirror read failed');
    const mirror = mirrorResult.data;

    const subscription = await this.retrieveSubscription(subscriptionId, null);
    if (!subscription) {
      logError('billing.subscription_unresolved', {
        eventId: event.id,
        subscriptionId,
        object: 'invoice',
      });
      return { ignored: true };
    }

    const owner =
      this.ownerFromMirror(mirror) ??
      this.ownerFromMetadata(subscription.metadata) ??
      this.ownerFromMetadata(invoice.parent?.subscription_details?.metadata ?? null) ??
      (objectId(invoice.customer)
        ? await this.ownerFromCustomer(objectId(invoice.customer)!)
        : null);
    if (!owner) {
      logError('billing.owner_unresolved', {
        eventId: event.id,
        objectId: invoice.id,
        object: 'invoice',
      });
      return { ignored: true };
    }

    const resolved = await this.resolvePlan(subscription, subscription.metadata, owner);
    if (!resolved) {
      logError('billing.price_unmapped', { eventId: event.id, subscriptionId });
      return { ignored: true };
    }

    // Reconcile the mirror from the *current* subscription (an upgrade with
    // `pending_if_incomplete` applies its price only after payment).
    const synced = await this.syncSubscription({
      eventId: event.id,
      eventCreated: event.created,
      claimToken,
      subscription,
      owner,
      resolved,
      mirror,
      expectedGeneration: mirror?.snapshotGeneration ?? 0,
      checkoutSessionId: mirror?.checkoutSessionId ?? null,
      applyEntitlement: ENTITLED_STATUSES.has(subscription.status),
    });
    if (synced.ignored && !synced.stale) return synced;

    const planName = resolved.plan.name;
    let payerId: string | null;
    if (owner.owner.type === 'user') {
      payerId = owner.owner.userId;
    } else {
      // The recorded purchaser may have been purged while the organization
      // subscription keeps billing; fall back to the oldest current admin.
      const recorded = mirror?.purchaserUserId ?? owner.purchaserUserId;
      if (recorded) {
        payerId = recorded;
      } else {
        const admin = await this.repository.findOldestOrgAdmin(owner.owner.orgId);
        if (isFailure(admin)) throw new Error('org admin lookup failed');
        payerId = admin.data;
      }
    }

    if (!payerId) {
      // Money was taken but no profile can own the history row. The
      // entitlement write above still happened; only the invoice log is lost.
      logError('billing.payments_no_attributable_user', {
        eventId: event.id,
        invoiceId: invoice.id,
        organizationId: owner.owner.type === 'org' ? owner.owner.orgId : null,
      });
      return { ignored: false };
    }

    // `payments.stripe_checkout_session_id` is UNIQUE: only the invoice that
    // created the subscription may carry it. Renewal/upgrade invoices are keyed
    // by `stripe_invoice_id` alone, otherwise the second invoice for the same
    // subscription would violate the index.
    const checkoutSessionId =
      invoice.billing_reason === 'subscription_create' ? (mirror?.checkoutSessionId ?? null) : null;

    const payment = await this.repository.insertPayment({
      userId: payerId,
      organizationId: owner.owner.type === 'org' ? owner.owner.orgId : null,
      planKey: resolved.plan.key,
      planName,
      amount: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),
      stripeCustomerId: objectId(invoice.customer),
      stripeSubscriptionId: subscriptionId,
      stripeInvoiceId: invoice.id,
      stripeCheckoutSessionId: checkoutSessionId,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      paidAt: secondsToIso(invoice.status_transitions.paid_at) ?? this.now().toISOString(),
    });

    if (isFailure(payment)) throw new Error('payment history write failed');
    if (payment.data.outcome === 'duplicate') {
      log('billing.payment_replay', { eventId: event.id, invoiceId: invoice.id });
    }

    return { ignored: false };
  }

  private async onInvoicePaymentProblem(
    event: Stripe.Event,
    actionRequired: boolean,
    claimToken: string,
  ): Promise<DispatchResult> {
    const invoice = invoicePayload(event);
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) {
      log('billing.invoice_without_subscription', { eventId: event.id, invoiceId: invoice.id });
      return { ignored: true };
    }

    if (actionRequired) {
      log('billing.invoice_action_required', {
        eventId: event.id,
        invoiceId: invoice.id,
      });
    }

    // Read the mirror before the provider snapshot so its generation fences a
    // same-second concurrent write.
    const mirrorResult = await this.repository.getSubscriptionByStripeId(subscriptionId);
    if (isFailure(mirrorResult)) throw new AppError('INTERNAL_SERVER');
    const mirror = mirrorResult.data;
    if (!mirror) {
      logError('billing.subscription_unresolved', {
        eventId: event.id,
        subscriptionId,
        object: 'invoice',
      });
      return { ignored: true };
    }
    if (event.created < mirror.lastEventCreated) {
      log('billing.webhook_out_of_order', {
        eventId: event.id,
        subscriptionId,
        eventCreated: event.created,
        lastEventCreated: mirror.lastEventCreated,
      });
      return { ignored: true };
    }

    const subscription = await this.retrieveSubscription(subscriptionId, null);
    if (!subscription) {
      logError('billing.subscription_unresolved', {
        eventId: event.id,
        subscriptionId,
        object: 'invoice',
      });
      return { ignored: true };
    }

    const owner =
      this.ownerFromMirror(mirror) ??
      this.ownerFromMetadata(subscription.metadata) ??
      this.ownerFromMetadata(invoice.parent?.subscription_details?.metadata ?? null) ??
      (objectId(invoice.customer)
        ? await this.ownerFromCustomer(objectId(invoice.customer)!)
        : null);
    if (!owner) {
      logError('billing.owner_unresolved', {
        eventId: event.id,
        objectId: invoice.id,
        object: 'invoice',
      });
      return { ignored: true };
    }

    const resolved = await this.resolvePlan(subscription, subscription.metadata, owner);
    if (!resolved) {
      logError('billing.price_unmapped', { eventId: event.id, subscriptionId });
      return { ignored: true };
    }

    // D14: a failed or 3DS-pending payment keeps access. The mirror follows the
    // **current** subscription status: `past_due`/`active` re-apply the same
    // plan, while `incomplete` leaves the entitlement untouched.
    return this.syncSubscription({
      eventId: event.id,
      eventCreated: event.created,
      claimToken,
      subscription,
      owner,
      resolved,
      mirror,
      expectedGeneration: mirror.snapshotGeneration,
      checkoutSessionId: mirror.checkoutSessionId,
      applyEntitlement: true,
    });
  }

  private async applyEntitlement(
    owner: EntitlementOwner,
    resolved: ResolvedPlan,
    status: string,
    fence: EntitlementFence,
    forceDowngrade?: boolean,
  ): Promise<ServiceResult<EntitlementApplyOutcome>> {
    if (forceDowngrade || DOWNGRADE_STATUSES.has(status)) {
      // A duplicate subscription that was refused at activation can be
      // cancelled later (§5.5 manual refund). Its `deleted` event must not
      // downgrade an owner who still pays for the *other*, active subscription.
      const active = await this.repository.findActiveSubscription(owner, this.livemode);
      if (isFailure(active)) return active;

      if (active.data && active.data.stripeSubscriptionId !== fence.stripeSubscriptionId) {
        logWarn('billing.downgrade_skipped_active_subscription', {
          subscriptionId: fence.stripeSubscriptionId,
          activeSubscriptionId: active.data.stripeSubscriptionId,
          ownerType: owner.type,
        });
        return success('applied');
      }

      return this.entitlements.downgradeToFreeFenced(owner, resolved.plan.key, fence);
    }
    if (ENTITLED_STATUSES.has(status)) {
      return this.entitlements.applyPlanFenced(owner, resolved.plan.key, fence);
    }
    // `incomplete` and anything unknown: keep the previous plan until the
    // invoice is paid or the subscription is deleted.
    return success('applied');
  }

  /** Owner priority (§6.4): mirror → metadata → customer mapping. */
  private ownerFromMirror(mirror: SubscriptionMirror | null): ResolvedOwner | null {
    if (!mirror) return null;
    if (mirror.organizationId) {
      return {
        owner: { type: 'org', orgId: mirror.organizationId },
        purchaserUserId: mirror.purchaserUserId,
      };
    }
    if (mirror.userId) {
      return {
        owner: { type: 'user', userId: mirror.userId },
        purchaserUserId: mirror.userId,
      };
    }
    return null;
  }

  private ownerFromMetadata(metadata: Stripe.Metadata | null | undefined): ResolvedOwner | null {
    if (!metadata) return null;

    const ownerType = metadata[METADATA_OWNER_TYPE];
    const userId = metadata[METADATA_USER_ID] || null;
    const orgId = metadata[METADATA_ORG_ID] || null;

    if (ownerType === 'org' && orgId) {
      return { owner: { type: 'org', orgId }, purchaserUserId: userId };
    }
    if (ownerType === 'user' && userId) {
      return { owner: { type: 'user', userId }, purchaserUserId: userId };
    }
    return null;
  }

  private async ownerFromCustomer(stripeCustomerId: string): Promise<ResolvedOwner | null> {
    const customer = await this.repository.findCustomerByStripeId(stripeCustomerId, this.livemode);
    if (isFailure(customer)) throw new Error('customer lookup failed');
    if (!customer.data) return null;

    if (customer.data.organizationId) {
      return {
        owner: { type: 'org', orgId: customer.data.organizationId },
        purchaserUserId: null,
      };
    }
    if (customer.data.userId) {
      return {
        owner: { type: 'user', userId: customer.data.userId },
        purchaserUserId: customer.data.userId,
      };
    }
    return null;
  }

  private async ensureCustomer(
    stripeCustomerId: string,
    owner: ResolvedOwner,
  ): Promise<ServiceResult<CustomerRow>> {
    return this.repository.ensureCustomer({
      stripeCustomerId,
      userId: owner.owner.type === 'user' ? owner.owner.userId : null,
      organizationId: owner.owner.type === 'org' ? owner.owner.orgId : null,
      livemode: this.livemode,
    });
  }

  /**
   * Plan resolution (§6.5): mapped Price first, then our own metadata
   * re-validated against the catalog. A manager plan never attaches to a user
   * (ADR-0007); a student plan never attaches to an organization.
   */
  private async resolvePlan(
    subscription: Stripe.Subscription,
    metadata: Stripe.Metadata | null | undefined,
    owner: ResolvedOwner,
    options: { allowInactive?: boolean } = {},
  ): Promise<ResolvedPlan | null> {
    const priceId = firstPriceId(subscription);
    if (!priceId) return null;

    const resolved = async (planKey: string | null | undefined): Promise<ResolvedPlan | null> => {
      if (!planKey) return null;
      const plan = await this.repository.getPlan(planKey);
      if (isFailure(plan)) throw new Error('plan lookup failed');
      if (!plan.data || !this.planMatchesOwner(plan.data, owner)) return null;
      if (!plan.data.isActive && !options.allowInactive) return null;
      return { plan: plan.data, priceId };
    };

    // 1. The current sellable mapping wins.
    const listed = await this.repository.findPrice(priceId, this.livemode);
    if (isFailure(listed)) throw new Error('price lookup failed');
    const fromMap = await resolved(listed.data?.active ? listed.data.planKey : null);
    if (fromMap) return fromMap;

    // 2. A Price rotated out of `stripe_prices` still carries its plan metadata,
    //    which checkout wrote at creation. The Price is authoritative; the
    //    subscription metadata goes stale after an in-app plan change.
    const fromPrice = await this.planKeyFromPriceMetadata(priceId);
    const resolvedFromPrice = await resolved(fromPrice);
    if (resolvedFromPrice) {
      logError('billing.price_unmapped', {
        subscriptionId: subscription.id,
        priceId,
        planKey: fromPrice,
        fallback: 'price_metadata',
      });
      return resolvedFromPrice;
    }

    // 3. Last resort: the subscription's own metadata (survives session expiry).
    const metadataPlanKey = metadata?.[METADATA_PLAN_KEY];
    const fromMetadata = await resolved(metadataPlanKey);
    if (fromMetadata) {
      logError('billing.price_unmapped', {
        subscriptionId: subscription.id,
        priceId,
        planKey: metadataPlanKey,
        fallback: 'subscription_metadata',
      });
    }
    return fromMetadata;
  }

  /**
   * Plan key written on the Price at bootstrap. A deleted Price is a permanent
   * `resource_missing` and falls through to the metadata fallback; any other
   * error is transient and must make the webhook retry rather than apply a
   * possibly stale plan from the subscription metadata.
   */
  private async planKeyFromPriceMetadata(priceId: string): Promise<string | null> {
    try {
      const price = await this.client.prices.retrieve(priceId);
      return price.metadata[METADATA_PLAN_KEY] ?? null;
    } catch (error) {
      if (isRecord(error) && readString(error, 'code') === 'resource_missing') return null;
      throw error;
    }
  }

  private planMatchesOwner(plan: CatalogPlan, owner: ResolvedOwner): boolean {
    const isManagerPlan = plan.forAccountType === 'manager';
    return owner.owner.type === 'org' ? isManagerPlan : !isManagerPlan;
  }

  /**
   * Always use the current subscription snapshot. A deleted subscription is
   * still retrievable; if Stripe has already pruned it, fall back to the event
   * payload for `customer.subscription.deleted`.
   */
  private async retrieveSubscription(
    subscriptionId: string,
    fallback: Stripe.Subscription | null,
  ): Promise<Stripe.Subscription | null> {
    try {
      return await this.client.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (fallback && isResourceMissing(error)) {
        logWarn('billing.subscription_retrieve_missing', { subscriptionId });
        return fallback;
      }
      throw error;
    }
  }

  /** Throws on a transient read failure so the event is retried. */
  private async ensureClaimOwner(eventId: string, claimToken: string): Promise<boolean> {
    const result = await this.repository.isClaimOwner(eventId, claimToken);
    if (isFailure(result)) throw new Error('claim ownership check failed');
    return result.data;
  }

  private async finish(event: Stripe.Event, claimToken: string, ignored: boolean): Promise<void> {
    const result = await this.repository.finishEvent(
      event.id,
      claimToken,
      ignored ? 'ignored' : 'processed',
    );
    if (isFailure(result)) {
      // Side effects already happened. Leaving the row `processing` means a
      // Stripe retry is answered as a duplicate (200), which is safer than
      // making Stripe retry a change that already applied.
      logWarn('billing.webhook_finish_failed', { eventId: event.id });
    }
  }

  private async markFailed(
    event: Stripe.Event,
    claimToken: string,
    message: string,
  ): Promise<void> {
    try {
      const result = await this.repository.finishEvent(event.id, claimToken, 'failed', message);
      if (isFailure(result)) {
        logWarn('billing.webhook_mark_failed_failed', { eventId: event.id });
      }
    } catch {
      logWarn('billing.webhook_mark_failed_failed', { eventId: event.id });
    }
  }
}
