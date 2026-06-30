'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards';

export default function EduTopicsClient() {
  const t = useTranslations('EduFlashcardTopicsPage');

  return <TopicManagementScreen apiBase="/api/v1/flashcards" t={t} />;
}
