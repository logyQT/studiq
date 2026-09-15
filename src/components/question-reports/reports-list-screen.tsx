'use client';

import { MessageSquareWarning } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers';
import { Card } from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useApiQuery } from '@/hooks/use-api';
import { questionReportKeys } from '@/lib/query-keys';

interface ReportRow {
  id: string;
  updated_at: string;
  isUnread: boolean;
  reported_by: string;
  teacher_id: string;
  question: { id: string; content: string } | null;
  group: { id: string; name: string } | null;
  reporter: { id: string; full_name: string | null; email: string } | null;
  teacher: { id: string; full_name: string | null; email: string } | null;
}

export function ReportsListScreen({ basePath }: { basePath: string }) {
  const t = useTranslations('QuestionReports');
  const { user } = useAuth();
  const { data: reports, isLoading } = useApiQuery<ReportRow[]>({
    queryKey: questionReportKeys.all,
    url: '/api/v1/question-reports',
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">{t('common_loading')}</div>;
  }

  if (!reports || reports.length === 0) {
    return (
      <Card className="p-12 flex flex-col items-center gap-3 text-center">
        <MessageSquareWarning className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{t('empty_title')}</p>
        <p className="text-sm text-muted-foreground">{t('empty_description')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {reports.map((report) => {
        const isReporter = report.reported_by === user?.id;
        const counterpart = isReporter ? report.teacher : report.reporter;

        return (
          <Link key={report.id} href={`${basePath}/reports/${report.id}`}>
            <Card className="p-4 flex items-center gap-3 hover:bg-accent/50 transition-colors">
              <UserAvatar name={counterpart?.full_name} email={counterpart?.email} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {counterpart?.full_name || counterpart?.email}
                  </span>
                  {report.isUnread && <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {report.question?.content ??
                    (report.group ? t('report_target_group', { name: report.group.name }) : '')}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(report.updated_at).toLocaleDateString()}
              </span>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
