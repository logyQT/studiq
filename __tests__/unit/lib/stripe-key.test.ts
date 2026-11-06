import { parseStripeKey } from '@studiq/server/lib/payment/stripe-key';
import { describe, expect, it } from 'vitest';

describe('parseStripeKey', () => {
  it.each([
    ['sk_test_abc', false],
    ['rk_test_abc', false],
    ['sk_live_abc', true],
    ['rk_live_abc', true],
  ])('derives livemode from %s', (key, livemode) => {
    expect(parseStripeKey(key)).toEqual({ livemode });
  });

  it('trims surrounding whitespace', () => {
    expect(parseStripeKey('  rk_live_abc  ')).toEqual({ livemode: true });
  });

  it.each(['pk_test_abc', 'sk_test_', 'rk_live_', '', 'sk_abc', 'sk_prod_abc'])(
    'rejects %s',
    (key) => {
      expect(parseStripeKey(key)).toBeNull();
    },
  );
});
