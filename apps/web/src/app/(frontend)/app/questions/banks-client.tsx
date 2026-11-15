'use client';

import { useTranslations } from 'next-intl';
import { QuestionBankManagementScreen } from '@/components/questions/screens/question-bank-management-screen';

export default function AppBanksClient() {
  const t = useTranslations('QuestionBankManagement');

  return <QuestionBankManagementScreen basePath="/app/questions" t={t} />;
}
