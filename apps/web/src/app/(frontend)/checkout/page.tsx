import { getPaymentGateway } from '@studiq/server/lib/payment/payment-gateway.factory';
import { Suspense } from 'react';
import { CheckoutMockForm } from '@/components/checkout/checkout-mock-form';
import { StripeCheckoutRedirect } from '@/components/checkout/stripe-checkout-redirect';
import { checkoutEntryFor } from '@/lib/checkout-entry';

/**
 * `/checkout` entry point (#662 §5.6).
 *
 * The page renders **one** of two things based on the boot-configured payment
 * driver:
 *
 * - `mock` → the simulated card form, unchanged (BIL-04/BIL-05/STU-52);
 * - `stripe` → a client component that starts hosted Checkout and redirects.
 *
 * A Stripe-mode deep link must never render the fake form: its only submit
 * path is the public webhook route, which answers 400 in that mode.
 *
 * `force-dynamic` is required because the driver is runtime configuration: a
 * static prerender at build time would bake in whatever mode the build used.
 */
export const dynamic = 'force-dynamic';

type CheckoutSearchParams = Record<string, string | string[] | undefined>;

interface CheckoutPageProps {
  searchParams: Promise<CheckoutSearchParams>;
}

/** `searchParams` can repeat a key; the checkout links only ever set singles. */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const params = await searchParams;
  const planKey = firstValue(params.plan_id);
  const orgId = firstValue(params.org_id);
  const canceled = firstValue(params.canceled) === '1';
  const entry = checkoutEntryFor(getPaymentGateway().driver);

  if (entry === 'stripe-redirect') {
    return <StripeCheckoutRedirect planKey={planKey ?? ''} orgId={orgId} canceled={canceled} />;
  }

  // The mock form is a client component that reads `useSearchParams`, so it
  // needs the same Suspense boundary the old client page provided.
  return (
    <Suspense>
      <CheckoutMockForm />
    </Suspense>
  );
}
