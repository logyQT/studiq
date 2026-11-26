import { describe, expect, it } from 'vitest';
import { pricingPlanAction, type PlanAction } from '@/lib/pricing-plan-action';

const reader = {
  signedIn: false,
  isCurrent: false,
  isFree: false,
  contactOnly: false,
  hasActivePlan: false,
};

function action(overrides: Partial<typeof reader>): PlanAction {
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

  it('prints no action on the row of the plan the reader owns', () => {
    expect(action({ signedIn: true, isCurrent: true, hasActivePlan: true })).toBe('none');
  });

  it('sends an existing subscriber to the billing change-plan page', () => {
    expect(action({ signedIn: true, hasActivePlan: true })).toBe('change-plan');
  });

  it('starts a checkout for a signed-in reader without a subscription', () => {
    expect(action({ signedIn: true })).toBe('checkout');
  });

  it('keeps contact above the signed-out rule', () => {
    expect(action({ contactOnly: true, signedIn: false })).toBe('contact');
  });

  it('keeps register above the free row', () => {
    expect(action({ signedIn: false, isFree: true })).toBe('register');
  });
});
