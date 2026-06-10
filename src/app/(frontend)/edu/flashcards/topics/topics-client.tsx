'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/topic-management-screen';

export default function EduTopicsClient() {
  const t = useTranslations('EduFlashcardTopicsPage');

  return (
    <TopicManagementScreen
      backHref="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
    />
  );
}
