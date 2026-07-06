'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useOrgs } from '@/hooks/use-orgs';

export default function EduLayout({ children }: { children: React.ReactNode }) {
  const { needsOnboarding } = useOrgs();
  const router = useRouter();

  useEffect(() => {
    if (needsOnboarding) {
      router.replace('/setup');
    }
  }, [needsOnboarding, router]);

  return <DashboardLayout>{children}</DashboardLayout>;
}
