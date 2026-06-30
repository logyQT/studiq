'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { FlashcardEditor } from '@/components/flashcards';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { useApiQuery } from '@/hooks/use-api';
import { apiPut } from '@/lib/api';
import { formatMarkdown } from '@/lib/markdown-utils';
import { flashcardKeys } from '@/lib/query-keys';
import type { Flashcard, Topic } from '@/types/flashcards';

interface EditCardClientProps {
  deckId: string;
  cardId: string;
}

export default function EditCardClient({ deckId, cardId }: EditCardClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('AppFlashcardDeckViewPage');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  const {
    data: flashcard,
    isLoading: flashcardLoading,
    error: flashcardError,
  } = useApiQuery<Flashcard>({
    queryKey: [...flashcardKeys.all, cardId],
    url: `/api/v1/flashcards/${cardId}`,
  });

  if (flashcard && !initialized) {
    setInitialized(true);
    setFront(flashcard.front);
    setBack(flashcard.back);
    setTopicIds(flashcard.flashcard_topic_assignments?.map((a) => a.topic_id) ?? []);
  }

  const { data: topicsData } = useApiQuery<{
    items: Topic[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics?limit=200',
  });
  const topics = topicsData?.items ?? [];

  const updateFlashcard = useMutation({
    mutationFn: (data: { id: string; front: string; back: string; topicIds: string[] }) =>
      apiPut(`/api/v1/flashcards/${data.id}`, {
        front: data.front,
        back: data.back,
        topicIds: data.topicIds,
      }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: flashcardKeys.list({ deckIds: [deckId] }) });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.detail(deckId) });
      toast.success(t('flashcard_updated'));
      router.push(`/app/flashcards/decks/${deckId}`);
    },
    onError: () => {
      toast.error(t('save_failed'));
    },
  });

  async function handleSave() {
    if (!front.trim() || !back.trim()) {
      toast.error(t('front_back_required'));
      return;
    }
    await updateFlashcard.mutateAsync({
      id: cardId,
      front: formatMarkdown(front),
      back: formatMarkdown(back),
      topicIds,
    });
  }

  const topicOptions = topics.map((topic) => ({ label: topic.name, value: topic.id }));
  const isSaving = updateFlashcard.isPending;

  if (flashcardLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (flashcardError || !flashcard) {
    return (
      <div className="space-y-6">
        <EntityNotFound titleKey="card_not_found" descriptionKey="card_not_found_desc" />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
      <div className="flex-1 min-h-0 flex flex-col gap-4">
        <FlashcardEditor
          front={front}
          back={back}
          onFrontChange={setFront}
          onBackChange={setBack}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-4 shrink-0">
        <MultiSelect
          options={topicOptions}
          selected={topicIds}
          onChange={setTopicIds}
          placeholder={t('topics_placeholder')}
          className="flex-1"
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => router.back()} disabled={isSaving}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? t('saving') : t('update')}
          </Button>
        </div>
      </div>
    </div>
  );
}
