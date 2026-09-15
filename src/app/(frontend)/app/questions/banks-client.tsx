'use client';

import { useTranslations } from 'next-intl';
import { QuestionBankManagementScreen } from '@/components/questions/screens/question-bank-management-screen';

export default function AppBanksClient() {
  const t = useTranslations('QuestionBankManagement');

  return (
    <QuestionBankManagementScreen apiBase="/api/v1/questions" basePath="/app/questions" t={t} />
  );
}
