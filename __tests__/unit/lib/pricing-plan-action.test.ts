import { describe, expect, it } from 'vitest';
import { pricingPlanAction, type PlanAction } from '@/lib/pricing-plan-action';

type PlanActionInput = Parameters<typeof pricingPlanAction>[0];

const reader: PlanActionInput = {
  signedIn: false,
  isCurrent: false,
  isFree: false,
  contactOnly: false,
  hasActivePlan: false,
};

function action(overrides: Partial<PlanActionInput>): PlanAction {
  return pricingPlanAction({ ...reader, ...overrides });
}

describe('pricingPlanAction', () => {
  it('gives a signed-out reader the register action', () => {
    expect(action({ signedIn: false })).toBe('register');
  });

  it('sends Campus to the sales conversation in every state', () => {
    expect(action({ contactOnly: true })).toBe('contact');
    expect(action({ contactOnly: true, signedIn: true, hasActivePlan: true })).toBe('contact');
  });

  it('prints no action on a free row for a signed-in reader', () => {
    expect(action({ signedIn: true, isFree: true })).toBe('none');
  });

  it('prints no action on a free row even when the reader pays for another plan', () => {
    // The free row is not a subscription to change: the subscriber's action is
    // the change-plan link on the paid rows, never a free-row checkout.
    expect(action({ signedIn: true, isFree: true, hasActivePlan: true })).toBe('none');
  });

  it('prints no action on the row of the plan the reader owns', () => {
    expect(action({ signedIn: true, isCurrent: true, hasActivePlan: true })).toBe('none');
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

  it('keeps contact above the signed-out rule', () => {
    expect(action({ contactOnly: true, signedIn: false })).toBe('contact');
  });

  it('keeps register above the free row', () => {
    expect(action({ signedIn: false, isFree: true })).toBe('register');
  });
});
