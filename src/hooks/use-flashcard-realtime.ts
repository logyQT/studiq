'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';

export function useFlashcardDomainRealtime() {
  const qc = useQueryClient();

  const invalidate = useCallback(
    (key: string[]) => { qc.invalidateQueries({ queryKey: key, exact: false }); },
    [qc],
  );

  useRealtimeChannel(
    channel('flashcards-domain')
      .listen('flashcards', () => invalidate(['flashcards', 'list']))
      .listen('flashcard_decks', () => invalidate(['flashcards', 'decks']))
      .listen('flashcard_deck_assignments', () => {
        invalidate(['flashcards', 'decks']);
        invalidate(['flashcards', 'list']);
      })
      .listen('flashcard_topics', () => invalidate(['flashcards', 'topics']))
      .listen('flashcard_topic_assignments', () => invalidate(['flashcards', 'list']))
      .listen('flashcard_practice', () => invalidate(['flashcards', 'practice']))
      .listen('flashcard_review_state', () => invalidate(['flashcards', 'practice'])),
  );
}
