import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { PricingPageClient } from '@/app/(frontend)/pricing/_components/pricing-page-client';
import { MarketingShell } from '@/components/layout/MarketingShell';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'PricingPage' });
  const title = t('title');
  const description = t('subtitle');

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
   * The audience is read from the query string by the client switch, and a
   * dynamic render is what lets that read answer during the server render too:
   * a cold `?audience=organization` arrives with the organization ladder in the
   * HTML instead of swapping after hydration. `connection()` is the request
   * signal that keeps the route out of the prerender.
   */
  await connection();

  return (
    <MarketingShell>
      <PricingPageClient />
    </MarketingShell>
  );
}
