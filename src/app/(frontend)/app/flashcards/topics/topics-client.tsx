'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/topic-management-screen';

export default function TopicsClient() {
  const t = useTranslations('AppFlashcardTopicsPage');

  return (
    <TopicManagementScreen
      backHref="/app/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
    />
  );
}
