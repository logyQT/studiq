'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/topic-management-screen';

export default function EduTopicsClient() {
  const t = useTranslations('EduFlashcardTopicsPage');
  const navT = useTranslations('EduFlashcardsPage');

  return (
    <TopicManagementScreen
      apiBase="/api/v1/flashcards"
      t={t}
      breadcrumbs={[
        { label: navT('title'), href: '/edu/flashcards' },
        { label: navT('topics_title'), href: '/edu/flashcards/topics' },
      ]}
    />
  );
}
