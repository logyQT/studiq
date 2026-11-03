import type { PaymentDriver, PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import { getPaymentGateway } from '@studiq/server/lib/payment/payment-gateway.factory';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutMockForm } from '@/components/checkout/checkout-mock-form';
import { StripeCheckoutRedirect } from '@/components/checkout/stripe-checkout-redirect';
import CheckoutPage from '@/app/(frontend)/checkout/page';
import { asJson } from '#test/helpers/json';

vi.mock('@studiq/server/lib/payment/payment-gateway.factory', () => ({
  getPaymentGateway: vi.fn(),
}));

function selectDriver(driver: PaymentDriver) {
  vi.mocked(getPaymentGateway).mockReturnValue(asJson<PaymentGateway>({ driver }));
}

type ElementShape = { type: unknown; props: Record<string, unknown> };

async function render(searchParams: Record<string, string | string[]>) {
  return asJson<ElementShape>(await CheckoutPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('/checkout driver branch (#662 §5.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the simulated form for the mock driver', async () => {
    selectDriver('mock');

    const element = await render({ plan_id: 'spark' });

    expect(element.type).toBe(Suspense);
    expect(asJson<ElementShape>(element.props.children).type).toBe(CheckoutMockForm);
  });

  it('never renders the simulated form for the stripe driver', async () => {
    selectDriver('stripe');

    const element = await render({ plan_id: 'spark' });

    expect(element.type).toBe(StripeCheckoutRedirect);
    expect(element.type).not.toBe(CheckoutMockForm);
    expect(element.props).toMatchObject({ planKey: 'spark', orgId: null, canceled: false });
  });

  it('passes the organization and canceled notice through', async () => {
    selectDriver('stripe');
    const orgId = '11111111-1111-4111-8111-111111111111';

    const element = await render({ plan_id: [' hub ', 'ignored'], org_id: orgId, canceled: '1' });

    expect(element.props).toMatchObject({ planKey: 'hub', orgId, canceled: true });
  });

  it('treats only canceled=1 as canceled and trims blank values', async () => {
    selectDriver('stripe');

    const notCanceled = await render({ plan_id: 'spark', canceled: '0', org_id: '   ' });
    const missing = await render({});

    expect(notCanceled.props).toMatchObject({ canceled: false, orgId: null });
    expect(missing.props).toMatchObject({ planKey: '', canceled: false });
  });
});
