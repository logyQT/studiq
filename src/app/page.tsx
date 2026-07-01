'use client';

import { MainLayout } from '@/components';
import { CtaBanner } from '@/components/marketing/cta-banner';
import { Features } from '@/components/marketing/features';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Pricing } from '@/components/marketing/pricing';
import { StatsBar } from '@/components/marketing/stats-bar';
import { Testimonials } from '@/components/marketing/testimonials';

export default function HomePage() {
  return (
    <MainLayout>
      <Hero />
      <StatsBar />
      <Features />
      <HowItWorks />
      <Testimonials />
      <Pricing />
      <CtaBanner />
    </MainLayout>
  );
}
