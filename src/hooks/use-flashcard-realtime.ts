'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';

export function useFlashcardDomainRealtime() {
  const qc = useQueryClient();
  // DO NOT REMOVE DEBOUNCE — coalesces rapid Supabase events into a single
  // re-fetch. Without it, saving a deck via the agent triggers N events in <1s,
  // causing cascading invalidateQueries that never settle.
  const [timers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>());

  const debouncedInvalidate = useCallback(
    (prefix: string[]) => {
      const key = prefix.join('::');
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          qc.invalidateQueries({ queryKey: prefix, exact: false });
        }, 1000),
      );
    },
    [qc, timers],
  );

  useRealtimeChannel(
    channel('flashcards-domain')
      .listen('flashcards', () => debouncedInvalidate(['flashcards', 'list']))
      .listen('flashcard_decks', () => debouncedInvalidate(['flashcards', 'decks']))
      .listen('flashcard_deck_assignments', () => {
        debouncedInvalidate(['flashcards', 'decks']);
        debouncedInvalidate(['flashcards', 'list']);
      })
      .listen('flashcard_topics', () => debouncedInvalidate(['flashcards', 'topics']))
      .listen('flashcard_topic_assignments', () => debouncedInvalidate(['flashcards', 'list']))
      .listen('flashcard_practice', () => debouncedInvalidate(['flashcards', 'practice']))
      .listen('flashcard_review_state', () => debouncedInvalidate(['flashcards', 'practice'])),
  );
}
