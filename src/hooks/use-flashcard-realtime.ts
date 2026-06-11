import { useQueryClient } from '@tanstack/react-query';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { flashcardKeys } from '@/lib/query-keys';

export function useFlashcardDomainRealtime() {
  const qc = useQueryClient();
  useRealtimeChannel(
    channel('flashcards-domain')
      .listen('flashcards', () => qc.invalidateQueries({ queryKey: flashcardKeys.all }))
      .listen('flashcard_decks', () => qc.invalidateQueries({ queryKey: flashcardKeys.all }))
      .listen('flashcard_deck_assignments', () => qc.invalidateQueries({ queryKey: flashcardKeys.all }))
      .listen('flashcard_topics', () => qc.invalidateQueries({ queryKey: flashcardKeys.all }))
      .listen('flashcard_topic_assignments', () => qc.invalidateQueries({ queryKey: flashcardKeys.all }))
      .listen('flashcard_practice', () => qc.invalidateQueries({ queryKey: flashcardKeys.all }))
      .listen('flashcard_review_state', () => qc.invalidateQueries({ queryKey: flashcardKeys.all })),
  );
}
