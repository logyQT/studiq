'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/screens/topic-management-screen';

export default function EduTopicsClient() {
  const t = useTranslations('EduFlashcardTopicsPage');

  return <TopicManagementScreen t={t} />;
}
