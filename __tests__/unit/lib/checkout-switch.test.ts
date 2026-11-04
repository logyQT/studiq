import { isCheckoutDisabled } from '@studiq/server/lib/payment/checkout-switch';
import { describe, expect, it } from 'vitest';

describe('isCheckoutDisabled', () => {
  it.each(['1', 'true', 'TRUE', 'yes', 'on', ' 1 '])('treats %s as on', (value) => {
    expect(isCheckoutDisabled({ CHECKOUT_KILL_SWITCH: value })).toBe(true);
  });

  it.each([undefined, '', ' ', '0', 'false', 'FALSE', 'off'])('treats %s as off', (value) => {
    expect(isCheckoutDisabled({ CHECKOUT_KILL_SWITCH: value })).toBe(false);
  });
});
