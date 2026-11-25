'use client';

import { useTranslations } from 'next-intl';
import { QuestionBankDetailScreen } from '@/components/questions/screens/question-bank-detail-screen';

export default function EduBankDetailClient({
  bankId,
  initialSearch,
}: {
  bankId: string;
  initialSearch?: string;
}) {
  const t = useTranslations('QuestionBankDetail');
  const tForm = useTranslations('QuestionForm');

  return (
    <QuestionBankDetailScreen
      bankId={bankId}
      basePath="/edu/questions"
      initialSearch={initialSearch}
      t={t}
      tForm={tForm}
    />
  );
}
