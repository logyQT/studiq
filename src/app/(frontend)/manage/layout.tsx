import { BreadcrumbProvider } from '@/components/providers/BreadcrumbProvider';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <BreadcrumbProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </BreadcrumbProvider>
  );
}
