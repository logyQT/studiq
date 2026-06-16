import { AppRealtimeProvider } from '@/components/providers/AppRealtimeProvider';
import { BreadcrumbProvider } from '@/components/providers/BreadcrumbProvider';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppRealtimeProvider>
      <BreadcrumbProvider>
        <DashboardLayout>{children}</DashboardLayout>
      </BreadcrumbProvider>
    </AppRealtimeProvider>
  );
}
