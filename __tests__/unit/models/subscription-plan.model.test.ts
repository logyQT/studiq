import {
  AssignPlanOrganizationSchema,
  CreateSubscriptionPlanSchema,
  UpdateSubscriptionPlanSchema,
} from '@studiq/server/models/subscription-plan.model';
import {
  billingModeAllowsSelfServe,
  isPubliclyListable,
  isSelfServePlan,
} from '@studiq/server/lib/payment/plan-availability';
import { describe, expect, it } from 'vitest';

const PLAN = { key: 'contract', name: 'Contract' };

describe('CreateSubscriptionPlanSchema (B3)', () => {
  it('defaults an omitted plan to public and Stripe-billed', () => {
    const result = CreateSubscriptionPlanSchema.parse(PLAN);

    expect(result.visibility).toBe('public');
    expect(result.billingMode).toBe('stripe');
  });

  it('accepts every visibility and billing mode the columns allow', () => {
    expect(
      CreateSubscriptionPlanSchema.parse({
        ...PLAN,
        visibility: 'unlisted',
        billingMode: 'invoice',
      }),
    ).toMatchObject({ visibility: 'unlisted', billingMode: 'invoice' });

    expect(CreateSubscriptionPlanSchema.parse({ ...PLAN, billingMode: 'none' }).billingMode).toBe(
      'none',
    );
  });

  it.each([
    ['visibility', 'hidden'],
    ['billingMode', 'cash'],
  ])('rejects an unknown %s', (field, value) => {
    const result = CreateSubscriptionPlanSchema.safeParse({ ...PLAN, [field]: value });

    expect(result.success).toBe(false);
  });
});

describe('UpdateSubscriptionPlanSchema (B3)', () => {
  it('leaves both fields absent when the body omits them', () => {
    const result = UpdateSubscriptionPlanSchema.parse({ name: 'Renamed' });

    expect(result).not.toHaveProperty('visibility');
    expect(result).not.toHaveProperty('billingMode');
  });

  it('accepts an unlisted switch on its own', () => {
    expect(UpdateSubscriptionPlanSchema.parse({ visibility: 'unlisted' }).visibility).toBe(
      'unlisted',
    );
  });
});

describe('AssignPlanOrganizationSchema', () => {
  it('accepts a uuid and rejects a non-uuid', () => {
    expect(
      AssignPlanOrganizationSchema.safeParse({
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true);
    expect(AssignPlanOrganizationSchema.safeParse({ organizationId: 'acme' }).success).toBe(false);
  });
});

describe('plan availability (B3)', () => {
  it('allows self-serve only for the Stripe billing mode', () => {
    expect(billingModeAllowsSelfServe('stripe')).toBe(true);
    expect(billingModeAllowsSelfServe('invoice')).toBe(false);
    expect(billingModeAllowsSelfServe('none')).toBe(false);
  });

  it('lists only a public plan', () => {
    expect(isPubliclyListable({ visibility: 'public' })).toBe(true);
    expect(isPubliclyListable({ visibility: 'unlisted' })).toBe(false);
  });

  it('derives selfServe from both axes', () => {
    expect(isSelfServePlan({ visibility: 'public', billingMode: 'stripe' })).toBe(true);
    expect(isSelfServePlan({ visibility: 'public', billingMode: 'invoice' })).toBe(false);
    expect(isSelfServePlan({ visibility: 'unlisted', billingMode: 'stripe' })).toBe(false);
  });
});
