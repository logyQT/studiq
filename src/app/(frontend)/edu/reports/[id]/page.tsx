import ReportThreadClient from '@/app/(frontend)/edu/reports/[id]/thread-client';

export default async function EduReportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportThreadClient reportId={id} />;
}
