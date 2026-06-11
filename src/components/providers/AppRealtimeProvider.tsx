'use client';

import { useFlashcardDomainRealtime } from '@/hooks/use-flashcard-realtime';
// future: import { useQuestionDomainRealtime } from '@/hooks/use-question-realtime';
// future: import { useNotesDomainRealtime } from '@/hooks/use-notes-realtime';

export function AppRealtimeProvider({ children }: { children: React.ReactNode }) {
  useFlashcardDomainRealtime();
  // future: useQuestionDomainRealtime();
  // future: useNotesDomainRealtime();
  return <>{children}</>;
}
