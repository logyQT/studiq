'use client';

import { ReportThreadScreen } from '@/components/question-reports/report-thread-screen';

export default function ReportThreadClient({ reportId }: { reportId: string }) {
  return <ReportThreadScreen reportId={reportId} basePath="/edu" />;
}
