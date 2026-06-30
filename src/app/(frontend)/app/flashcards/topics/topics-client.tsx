'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards';

export default function TopicsClient() {
  const t = useTranslations('AppFlashcardTopicsPage');

  return <TopicManagementScreen apiBase="/api/v1/flashcards" t={t} />;
}
