'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { FlashcardEditor } from '@/components/flashcards/flashcard-editor';
import { useBreadcrumbContext } from '@/components/providers/BreadcrumbProvider';
import { useApiQuery } from '@/hooks/use-api';
import { apiPost } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import { formatMarkdown } from '@/lib/markdown-utils';
import { toast } from 'sonner';
import type { Deck, Topic } from '@/types/flashcards';

interface NewCardClientProps {
  deckId: string;
}

export default function NewCardClient({ deckId }: NewCardClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('AppFlashcardDeckViewPage');
  const { setDynamicSegments } = useBreadcrumbContext();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);

  const deck = queryClient.getQueryData<Deck>(flashcardKeys.decks.detail(deckId));

  useEffect(() => {
    setDynamicSegments([
      { label: deck?.name ?? '', href: `/app/flashcards/deck/${deckId}` },
      { label: t('create_title'), href: '#' },
    ]);
    return () => setDynamicSegments([]);
  }, [deck, deckId, t, setDynamicSegments]);

  const { data: topics = [] } = useApiQuery<Topic[]>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics',
  });

  const createFlashcard = useMutation({
    mutationFn: (data: { front: string; back: string; deckId: string; topicIds?: string[] }) =>
      apiPost('/api/v1/flashcards', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: flashcardKeys.all });
      toast.success(t('flashcard_created'));
      router.push(`/app/flashcards/deck/${deckId}`);
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
    await createFlashcard.mutateAsync({
      front: formatMarkdown(front),
      back: formatMarkdown(back),
      deckId,
      topicIds: topicIds.length > 0 ? topicIds : undefined,
    });
  }

  const topicOptions = topics.map((topic) => ({ label: topic.name, value: topic.id }));
  const isSaving = createFlashcard.isPending;

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
            {isSaving ? t('saving') : t('create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
