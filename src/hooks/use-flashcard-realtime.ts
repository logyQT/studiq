import { useQueryClient } from '@tanstack/react-query';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';

function invalidatePrefix(qc: ReturnType<typeof useQueryClient>, prefix: string[]) {
  qc.invalidateQueries({ queryKey: prefix, exact: false });
}

export function useFlashcardDomainRealtime() {
  const qc = useQueryClient();

  const invalidateDecks = () => invalidatePrefix(qc, ['flashcards', 'decks']);
  const invalidateLists = () => invalidatePrefix(qc, ['flashcards', 'list']);
  const invalidateTopics = () => invalidatePrefix(qc, ['flashcards', 'topics']);
  const invalidatePractice = () => invalidatePrefix(qc, ['flashcards', 'practice']);

  useRealtimeChannel(
    channel('flashcards-domain')
      .listen('flashcards', invalidateLists)
      .listen('flashcard_decks', invalidateDecks)
      .listen('flashcard_deck_assignments', () => { invalidateDecks(); invalidateLists(); })
      .listen('flashcard_topics', invalidateTopics)
      .listen('flashcard_topic_assignments', invalidateLists)
      .listen('flashcard_practice', invalidatePractice)
      .listen('flashcard_review_state', invalidatePractice),
  );
}
