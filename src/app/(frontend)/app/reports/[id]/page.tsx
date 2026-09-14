import ReportThreadClient from '@/app/(frontend)/app/reports/[id]/thread-client';

export default async function AppReportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportThreadClient reportId={id} />;
}
