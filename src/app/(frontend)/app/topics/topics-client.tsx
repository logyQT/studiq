'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/screens/topic-management-screen';

export default function TopicsClient() {
  const t = useTranslations('AppFlashcardTopicsPage');

  return <TopicManagementScreen apiBase="/api/v1" t={t} />;
}
