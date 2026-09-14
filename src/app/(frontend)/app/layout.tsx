'use client';

import { usePathname } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

const FULL_WIDTH_ROUTES = ['/app/ai'];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullWidth = FULL_WIDTH_ROUTES.some((route) => pathname === route);

  return <DashboardLayout fullWidth={fullWidth}>{children}</DashboardLayout>;
}
