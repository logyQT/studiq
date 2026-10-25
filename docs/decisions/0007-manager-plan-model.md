# ADR-0007: Managers Have No Paid Personal Plan

## Status

Accepted

## Context

`subscription_plans.for_account_type = 'manager'` means "organization plan"
(`launch`, `team`, `hub`, `campus`), but the mock checkout wrote every purchased
plan into the buyer's `profiles.personal_plan_key` — including org plans
(`MockStripeService.handleWebhook`). A manager who bought Hub for one
organization therefore carried `hub` as their *personal* plan everywhere:

- `LimitsResolver` resolved `max(personal, org)` for an unseated member, so
  Campus bought for organization A leaked unlimited capacity into organization B
  (a paid-capacity bypass, not just a display bug).
- `/pricing/org` badged the "current plan" from `/me/personal-plan`, so the org
  plan of one organization looked current in every other organization.
- `/api/v1/me/personal-plan`, `getUsage().plan` and the admin user list showed
  an organization plan as a person's plan.
- The personal plan was not tied to membership, so it survived removal from the
  organization.

The read path was already settled in #181/#270/`docs/limits.md`: a manager in an
active organization sees the organization's plan (they are its billing contact),
and `personal_plan_key` is meant for outside-organization context. The write path
and the limits resolver did not honour that decision.

## Decision

**Option A — managers have no paid personal plan.**

1. An organization purchase changes only the organization
   (`apply_org_plan` + the `payments` row). `MockStripeService.handleWebhook`
   writes `profiles.personal_plan_key` only for a plan bought for the buyer
   themselves.
2. A manager's personal plan is the free manager tier (`launch`) and applies
   only outside any organization.
3. In a verified organization, limits come from the organization plan only.
   Seats remain a separate, organization-scoped allocation and still win for
   per-member (`scope: 'user'`) limit keys.
4. `/me/plan` is unchanged: active organization's plan for a manager, personal
   plan otherwise.
5. `/pricing/org` badges the current plan from `/me/plan` for managers (and keeps
   `/me/personal-plan` for students/educators).
6. `getPersonalPlan` never reports a paid organization plan as a manager's
   personal plan; legacy rows that still hold one resolve to the free manager
   tier.

### Rejected

- **B — add `subscription_plans.scope`:** removes the
  `for_account_type = 'manager'` inference, but `launch` is both the free
  manager personal plan and the default organization plan, so a binary scope
  cannot represent it. Bigger surface for the same user outcome today.
- **C — separate paid manager personal plan family:** needs new prices,
  features, i18n, an org-less checkout path, and a rule for stacking a manager
  seat with a personal plan. Needs a pricing owner.
- **D — display-only fix:** leaves the cross-organization limit leak and a
  "personal" plan that is an organization plan.
- **Literal issue option 2 ("no personal plans for managers"):** a manager with
  no organization still needs the free `launch` entitlements (`org.manage`) to
  create their first organization.

### Data

No backfill and no migration: operator decision. Existing rows written before
the invariant are left in place and are inert on the read paths above
(`getPersonalPlan` resolves them to the free manager tier, in-organization limits
ignore them, and the org pricing badge no longer reads them). `payments.organization_id`
preserves the purchase context if a reset is ever wanted.

## Consequences

### Positive

- Organization purchases no longer widen a manager's limits in another
  organization.
- "Personal plan" for a manager is always a plan the manager can actually hold,
  and billing/pricing agree with `/me/plan`.
- No schema change; the webhook loses one failure point.

### Negative

- A manager outside every organization keeps only the free `launch` tier; there
  is no paid individual manager plan until B/C lands.
- `launch` stays dual-purpose (free manager personal plan *and* default
  organization plan) because the catalog has no `scope`.
- A manager who was removed from an organization can still hold a legacy paid
  value in `personal_plan_key`; outside any organization that value is still
  read by `LimitsResolver`. Accepted with the no-backfill decision — a reset is
  the follow-up if that becomes reachable in practice.
- A seated manager's `/me/plan` still shows the organization plan while
  enforcement uses the seat plan (the #270-shaped display gap); tracked
  separately.

## References

- `packages/server/src/services/mock-stripe.service.ts`
- `packages/server/src/services/limits.resolver.ts`
- `packages/server/src/services/subscription-plan.service.ts`
- `apps/web/src/app/(frontend)/pricing/_components/pricing-content.tsx`
- `docs/limits.md`, `docs/plans/seat-based-licensing.md`
