import { useQueryClient } from '@tanstack/react-query';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { flashcardKeys } from '@/lib/query-keys';
import type { Flashcard } from '@/hooks/use-flashcard-queries';

export function useDeckFlashcardRealtime(deckId: string) {
  const qc = useQueryClient();
  const queryKey = flashcardKeys.list({ deckIds: [deckId] });
  useRealtimeChannel(
    channel(`deck-flashcards-${deckId}`)
      .listen(
        'flashcard_deck_assignments',
        () => qc.invalidateQueries({ queryKey }),
        { filter: `deck_id=eq.${deckId}` },
      )
      .listen(
        'flashcards',
        (p) => {
          const cached = qc.getQueryData<Flashcard[]>(queryKey);
          if (cached?.some((fc) => fc.id === p.new.id)) qc.invalidateQueries({ queryKey });
        },
        { event: 'UPDATE' },
      ),
  );
}

export function useDeckListRealtime() {
  const qc = useQueryClient();
  useRealtimeChannel(
    channel('deck-list')
      .listen('flashcard_decks', () => qc.invalidateQueries({ queryKey: flashcardKeys.decks.all })),
  );
}

export function useTopicRealtime() {
  const qc = useQueryClient();
  useRealtimeChannel(
    channel('topics')
      .listen('flashcard_topics', () => qc.invalidateQueries({ queryKey: flashcardKeys.topics.all }))
      .listen('flashcard_topic_assignments', () => qc.invalidateQueries({ queryKey: flashcardKeys.topics.all })),
  );
}
