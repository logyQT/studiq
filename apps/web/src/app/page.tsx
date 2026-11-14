import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/MarketingShell';
import { CtaBanner } from '@/components/marketing/cta-banner';
import { Features } from '@/components/marketing/features';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Pricing } from '@/components/marketing/pricing';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'LandingPage' });
  const title = t('hero_title');
  const description = t('hero_subtitle');

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function HomePage() {
  return (
    <MarketingShell>
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <CtaBanner />
    </MarketingShell>
  );
}
