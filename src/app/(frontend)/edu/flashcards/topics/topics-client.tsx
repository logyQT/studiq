'use client';

import { useTranslations } from 'next-intl';
import { TopicManagementScreen } from '@/components/flashcards/topic-management-screen';

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  created_at?: string;
}

interface EduTopicsClientProps {
  topics: Topic[];
  flashcards: Flashcard[];
}

export default function EduTopicsClient({ topics, flashcards }: EduTopicsClientProps) {
  const t = useTranslations('EduFlashcardTopicsPage');

  return (
    <TopicManagementScreen
      topics={topics}
      flashcards={flashcards}
      backHref="/edu/flashcards"
      apiBase="/api/v1/flashcards"
      t={t}
    />
  );
}
