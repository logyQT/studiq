'use client';

import { useTranslations } from 'next-intl';
import { QuestionBankManagementScreen } from '@/components/questions/screens/question-bank-management-screen';

export default function EduBanksClient() {
  const t = useTranslations('QuestionBankManagement');

  return (
    <QuestionBankManagementScreen apiBase="/api/v1/questions" basePath="/edu/questions" t={t} />
  );
}
