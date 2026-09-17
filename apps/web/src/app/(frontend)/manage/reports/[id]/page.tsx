import ManageReportThreadClient from '@/app/(frontend)/manage/reports/[id]/thread-client';

export default async function ManageReportThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ManageReportThreadClient reportId={id} />;
}
