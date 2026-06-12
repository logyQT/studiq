'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/topic-management-screen';

export default function TopicsClient() {
  const t = useTranslations('AppFlashcardTopicsPage');
  const navT = useTranslations('AppFlashcardsPage');

  return (
    <TopicManagementScreen
      apiBase="/api/v1/flashcards"
      t={t}
      breadcrumbs={[
        { label: navT('title'), href: '/app/flashcards' },
        { label: navT('topics_title'), href: '/app/flashcards/topics' },
      ]}
    />
  );
}
