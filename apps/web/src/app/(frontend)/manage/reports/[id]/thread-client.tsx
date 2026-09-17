'use client';

import { ReportThreadScreen } from '@/components/question-reports/report-thread-screen';

export default function ManageReportThreadClient({ reportId }: { reportId: string }) {
  return <ReportThreadScreen reportId={reportId} basePath="/manage" />;
}
