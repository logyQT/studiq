import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { PricingSlugClient } from '@/app/(frontend)/pricing/[slug]/pricing-slug-client';

const SLUG_MAP: Record<string, string> = {
  student: 'student',
  edu: 'educator',
  org: 'manager',
};

const TITLE_KEYS: Record<string, string> = {
  student: 'tile_student_title',
  edu: 'tile_edu_title',
  org: 'tile_org_title',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const titleKey = TITLE_KEYS[slug];
  if (!titleKey) return {};

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'PricingPage' });
  const title = t(titleKey);

  return {
    title,
    openGraph: { title },
    twitter: { card: 'summary_large_image', title },
  };
}

export default async function PricingSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const accountType = SLUG_MAP[slug];
  if (!accountType) notFound();

  return <PricingSlugClient accountType={accountType} />;
}
