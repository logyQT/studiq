'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useOrgs } from '@/hooks/use-orgs';

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  const { needsOnboarding } = useOrgs();
  const router = useRouter();

  useEffect(() => {
    if (needsOnboarding) {
      router.replace('/setup/org');
    }
  }, [needsOnboarding, router]);

  return <DashboardLayout>{children}</DashboardLayout>;
}
