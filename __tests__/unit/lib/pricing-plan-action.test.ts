import { describe, expect, it } from 'vitest';
import { pricingPlanAction, type PlanAction } from '@/lib/pricing-plan-action';

type PlanActionInput = Parameters<typeof pricingPlanAction>[0];

const reader: PlanActionInput = {
  signedIn: false,
  isCurrent: false,
  isFree: false,
  hasActivePlan: false,
};

function action(overrides: Partial<PlanActionInput>): PlanAction {
  return pricingPlanAction({ ...reader, ...overrides });
}

describe('pricingPlanAction', () => {
  it('gives a signed-out reader the register action', () => {
    expect(action({ signedIn: false })).toBe('register');
  });

  it('prints no action on a free row for a signed-in reader', () => {
    expect(action({ signedIn: true, isFree: true })).toBe('none');
  });

  it('sends the subscriber’s free row to the billing downgrade', () => {
    // The free row is a downgrade for a subscriber, not a second checkout and
    // not an empty cell (#1523).
    expect(action({ signedIn: true, isFree: true, hasActivePlan: true })).toBe('change-plan');
  });

  it('prints no action on a free row for a reader with no subscription', () => {
    // There is nothing to check out on a free row, so the cell stays empty.
    expect(action({ signedIn: true, isFree: true, hasActivePlan: false })).toBe('none');
  });

  it('prints no action for a manager with a cached personal plan', () => {
    // A manager holds no personal plan (ADR-0007), but a stale `/me/personal-plan`
    // cache can still report one. `purchaseBlocked` sits above `hasActivePlan`, so
    // the row stays empty instead of offering a change-plan the server refuses.
    expect(action({ signedIn: true, purchaseBlocked: true, hasActivePlan: true })).toBe('none');
  });

  it('marks the paid plan the reader owns as current', () => {
    expect(action({ signedIn: true, isCurrent: true, hasActivePlan: true })).toBe('current');
  });

  it('marks the free plan the reader owns as current', () => {
    // `isCurrent` sits above `isFree`: the free plan's own row gets the same
    // disabled action, while a different free row stays `none`.
    expect(action({ signedIn: true, isCurrent: true, isFree: true })).toBe('current');
  });

  it('sends an existing subscriber to the billing change-plan page', () => {
    expect(action({ signedIn: true, hasActivePlan: true })).toBe('change-plan');
  });

  it('starts a checkout for a signed-in reader without a subscription', () => {
    expect(action({ signedIn: true })).toBe('checkout');
  });

  it('prints no action while the plan read is pending or failed', () => {
    // `null` is "not known yet", not "no subscription": a failed read must not
    // turn a subscriber into a checkout that the server refuses.
    expect(action({ signedIn: true, hasActivePlan: null })).toBe('none');
  });

  it('keeps register above the free row', () => {
    expect(action({ signedIn: false, isFree: true })).toBe('register');
  });
});
