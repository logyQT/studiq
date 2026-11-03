import { ApiError } from '@/lib/api';
import {
  checkoutEntryFor,
  checkoutFailureFor,
  checkoutOrgIdFor,
  checkoutSessionBody,
  initialCheckoutStatus,
  isAllowedStripeCheckoutUrl,
} from '@/lib/checkout-entry';
import { describe, expect, it } from 'vitest';

const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111';

/**
 * `/checkout` must never render the simulated card form in Stripe mode
 * (#662 §5.6): that form can only post to the public webhook route, which
 * answers 400 when `PAYMENT_DRIVER=stripe`.
 */
describe('checkout entry selection (#662 §5.6)', () => {
  it('keeps the mock form for the mock driver', () => {
    expect(checkoutEntryFor('mock')).toBe('mock-form');
  });

  it('redirects to hosted Stripe for the stripe driver', () => {
    expect(checkoutEntryFor('stripe')).toBe('stripe-redirect');
  });
});

describe('initialCheckoutStatus', () => {
  it('starts a fresh deep link', () => {
    expect(initialCheckoutStatus({ planKey: 'spark', canceled: false })).toBe('starting');
  });

  it('does not auto-start after a canceled Checkout (prevents a redirect loop)', () => {
    expect(initialCheckoutStatus({ planKey: 'spark', canceled: true })).toBe('canceled');
  });

  it('fails closed when no plan was selected', () => {
    expect(initialCheckoutStatus({ planKey: '', canceled: false })).toBe('missing-plan');
  });
});

describe('checkoutOrgIdFor', () => {
  it('keeps a valid organization uuid', () => {
    expect(checkoutOrgIdFor(VALID_ORG_ID)).toBe(VALID_ORG_ID);
  });

  it('drops a user-editable non-uuid org hint', () => {
    expect(checkoutOrgIdFor('not-a-uuid')).toBeUndefined();
    expect(checkoutOrgIdFor('  ')).toBeUndefined();
    expect(checkoutOrgIdFor(null)).toBeUndefined();
  });
});

describe('checkoutSessionBody', () => {
  it('only sends the plan key for a personal checkout', () => {
    expect(checkoutSessionBody({ planKey: 'spark' })).toEqual({ planKey: 'spark' });
  });

  it('adds a valid org hint and locale', () => {
    expect(checkoutSessionBody({ planKey: 'hub', orgId: VALID_ORG_ID, locale: 'en' })).toEqual({
      planKey: 'hub',
      orgId: VALID_ORG_ID,
      locale: 'en',
    });
  });

  it('never forwards an amount, price, customer or owner id', () => {
    const body = checkoutSessionBody({
      planKey: 'spark',
      orgId: VALID_ORG_ID,
      locale: 'pl',
    });

    expect(Object.keys(body).toSorted()).toEqual(['locale', 'orgId', 'planKey']);
  });
});

describe('checkoutFailureFor', () => {
  it('points an already-subscribed owner at the billing page without retrying', () => {
    expect(checkoutFailureFor(new ApiError('CONFLICT', 409))).toEqual({
      code: 'CONFLICT',
      retryable: false,
      manageSubscription: true,
    });
  });

  it('does not offer a retry for permanent authorization/validation refusals', () => {
    for (const code of ['FORBIDDEN', 'UNAUTHORIZED', 'UNPROCESSABLE_ENTITY', 'BAD_REQUEST']) {
      expect(checkoutFailureFor(new ApiError(code, 400))).toMatchObject({
        code,
        retryable: false,
        manageSubscription: false,
      });
    }
  });

  it('treats transport and provider outages as retryable', () => {
    for (const error of [
      new ApiError('NETWORK_ERROR', 0),
      new ApiError('SERVICE_UNAVAILABLE', 503),
      new Error('boom'),
    ]) {
      expect(checkoutFailureFor(error)).toMatchObject({ retryable: true });
    }
  });
});

describe('isAllowedStripeCheckoutUrl', () => {
  it('accepts a Stripe-hosted https URL', () => {
    expect(isAllowedStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe(true);
  });

  it('rejects non-https, foreign hosts and malformed input', () => {
    for (const url of [
      'http://checkout.stripe.com/c/pay/cs_test_1',
      'https://checkout.stripe.com.example.com/pay',
      'https://evil.example/pay',
      'javascript:alert(1)',
      '/checkout?plan_id=spark',
      '',
    ]) {
      expect(isAllowedStripeCheckoutUrl(url)).toBe(false);
    }
  });
});
