import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import type { PricingAudience } from '@/app/(frontend)/pricing/_components/audience-switch';
import { PricingPageClient } from '@/app/(frontend)/pricing/_components/pricing-page-client';
import { MarketingShell } from '@/components/layout/MarketingShell';

type PricingSearchParams = Record<string, string | string[] | undefined>;

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

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<PricingSearchParams>;
}) {
  const { audience } = await searchParams;
  // A query key can repeat; the switch only ever writes a single value.
  const selected = Array.isArray(audience) ? audience[0] : audience;
  const initialAudience: PricingAudience =
    selected === 'organization' ? 'organization' : 'individual';

  return (
    <MarketingShell>
      <PricingPageClient initialAudience={initialAudience} />
    </MarketingShell>
  );
}
