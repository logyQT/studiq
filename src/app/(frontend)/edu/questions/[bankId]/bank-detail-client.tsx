'use client';

import { useTranslations } from 'next-intl';
import { QuestionBankDetailScreen } from '@/components/questions/screens/question-bank-detail-screen';

export default function EduBankDetailClient({ bankId }: { bankId: string }) {
  const t = useTranslations('QuestionBankDetail');
  const tForm = useTranslations('QuestionForm');

  return <QuestionBankDetailScreen bankId={bankId} basePath="/edu/questions" t={t} tForm={tForm} />;
}
