'use client';

import { useTranslations } from 'next-intl';
import { ReportsListScreen } from '@/components/question-reports/reports-list-screen';

export default function ReportsClient() {
  const t = useTranslations('QuestionReports');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('page_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('page_description_student')}</p>
      </div>
      <ReportsListScreen basePath="/app" />
    </div>
  );
}
