import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';

export function useFlashcardDomainRealtime() {
  const qc = useQueryClient();
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const debouncedInvalidate = useCallback((prefix: string[]) => {
    const key = prefix.join('::');
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        qc.invalidateQueries({ queryKey: prefix, exact: false });
      }, 1000),
    );
  }, []);

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
