'use client';

import { notFound, useParams } from 'next/navigation';
import { PricingContent } from '@/app/(frontend)/pricing/_components/pricing-content';

const SLUG_MAP: Record<string, string> = {
  student: 'student',
  edu: 'educator',
  org: 'manager',
};

export default function PricingSlugPage() {
  const params = useParams<{ slug: string }>();

  const accountType = SLUG_MAP[params.slug];
  if (!accountType) notFound();

  return <PricingContent accountType={accountType} />;
}
