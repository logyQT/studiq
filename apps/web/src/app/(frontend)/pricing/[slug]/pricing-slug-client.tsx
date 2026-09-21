'use client';

import { PricingContent } from '@/app/(frontend)/pricing/_components/pricing-content';

export function PricingSlugClient({ accountType }: { accountType: string }) {
  return <PricingContent accountType={accountType} />;
}
