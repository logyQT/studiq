import { AppRealtimeProvider } from '@/components/providers/AppRealtimeProvider';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppRealtimeProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </AppRealtimeProvider>
  );
}
