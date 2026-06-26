'use client';

import { usePathname } from 'next/navigation';
import { BreadcrumbProvider } from '@/components/providers/BreadcrumbProvider';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

const FULL_WIDTH_ROUTES = ['/app', '/app/ai'];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullWidth = FULL_WIDTH_ROUTES.some((route) => pathname === route);

  return (
    <BreadcrumbProvider>
      <DashboardLayout fullWidth={fullWidth} hideBreadcrumbs={pathname === '/app'}>
        {children}
      </DashboardLayout>
    </BreadcrumbProvider>
  );
}
