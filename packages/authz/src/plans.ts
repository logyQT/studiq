/**
 * The plan catalogue's three closed value sets.
 *
 * They live here, not in the server model, because the admin panel maps its
 * selects over the same tuples: a new scope, visibility or billing mode is one
 * edit, and the write schema (`@studiq/server/models/subscription-plan.model`)
 * and the form cannot drift. No Zod import: this package stays dependency-free.
 */

export const PLAN_SCOPES = ['personal', 'organization'] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number];

/**
 * Where a plan is sold (#1511). `individual` is the existing plan and
 * organization checkout; `seat_pool` is an organization seat licence. A plan
 * can be sold through both. These values and the CHECK constraint on
 * `subscription_plans.sales_channels` are the same closed set, pinned by
 * `catalog-invariants`.
 */
export const SALES_CHANNELS = ['individual', 'seat_pool'] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];
/** The two values, named once so a filter cannot spell one of them wrong. */
export const SALES_CHANNEL_INDIVIDUAL: SalesChannel = 'individual';
export const SALES_CHANNEL_SEAT_POOL: SalesChannel = 'seat_pool';

/** `unlisted` is a sales-led contract plan: never in a public read (B3, #1495). */
export const PLAN_VISIBILITIES = ['public', 'unlisted'] as const;
export type PlanVisibility = (typeof PLAN_VISIBILITIES)[number];

/**
 * How a plan may be paid for. Only `stripe` is self-serve today; `invoice` and
 * `none` exist so a later sales-led billing path is a value, not a rewrite of
 * the checkout rule.
 */
export const PLAN_BILLING_MODES = ['stripe', 'invoice', 'none'] as const;
export type PlanBillingMode = (typeof PLAN_BILLING_MODES)[number];
