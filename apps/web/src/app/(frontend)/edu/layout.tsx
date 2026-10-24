'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useOrgs } from '@/hooks/use-orgs';

const FULL_WIDTH_ROUTES = ['/edu/ai'];

export default function EduLayout({ children }: { children: React.ReactNode }) {
  const { needsOnboarding } = useOrgs();
  const router = useRouter();
  const pathname = usePathname();
  const fullWidth = FULL_WIDTH_ROUTES.some((route) => pathname === route);

  useEffect(() => {
    if (needsOnboarding) {
      router.replace('/setup');
    }
  }, [needsOnboarding, router]);

  return <DashboardLayout fullWidth={fullWidth}>{children}</DashboardLayout>;
}
