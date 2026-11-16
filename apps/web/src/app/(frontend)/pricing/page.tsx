import { isSuccess } from '@studiq/server/lib/service-result';
import { subscriptionPlanService } from '@studiq/server/services/subscription-plan.service';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { PricingPageClient } from '@/app/(frontend)/pricing/_components/pricing-page-client';
import { MarketingShell } from '@/components/layout/MarketingShell';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'PricingPage' });
  const title = t('title');
  /*
   * One page, two audiences: the description names both ladders, so a search
   * result or a shared link says which catalogues are behind the single URL.
   */
  const description = t('description');

  return {
    title,
    description,
    // One URL serves both audiences (the switch is a query param, the locale is a
    // cookie), so there is no second address for an `hreflang` pair to name.
    alternates: { canonical: '/pricing' },
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function PricingPage() {
  /*
   * The catalogue is read here, not only in the browser: prices are the one thing
   * a crawler or a shared `?audience=organization` link should read, so a cold
   * response carries the ladder rows instead of a spinner. The client query still
   * runs and owns later refetches — this is the first paint, not a second source
   * of truth. A failed read passes `undefined`, which leaves the client's own
   * "catalogue unavailable" line to say so.
   */
  await connection();

  const catalogue = await subscriptionPlanService.listActive();

  return (
    <MarketingShell>
      <PricingPageClient initialPlans={isSuccess(catalogue) ? catalogue.data : undefined} />
    </MarketingShell>
  );
}
