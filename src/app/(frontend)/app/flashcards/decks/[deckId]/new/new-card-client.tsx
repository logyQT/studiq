'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { FlashcardEditor } from '@/components/flashcards';
import { useApiQuery } from '@/hooks/use-api';
import { apiPost } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import { formatMarkdown } from '@/lib/markdown-utils';
import { toast } from 'sonner';
import type { Topic } from '@/types/flashcards';
import { useFeature } from '@/hooks/use-feature';
import { Lock } from 'lucide-react';

interface NewCardClientProps {
  deckId: string;
}

export default function NewCardClient({ deckId }: NewCardClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('AppFlashcardDeckViewPage');
  const { hasAccess } = useFeature('study.create');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);

  const { data: topicsData } = useApiQuery<{ items: Topic[]; nextCursor: string | null; hasMore: boolean }>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics?limit=200',
  });
  const topics = topicsData?.items ?? [];

  const createFlashcard = useMutation({
    mutationFn: (data: { front: string; back: string; deckId: string; topicIds?: string[] }) =>
      apiPost('/api/v1/flashcards', data),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: flashcardKeys.list({ deckIds: [deckId] }) });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.detail(deckId) });
      toast.success(t('flashcard_created'));
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
          <Button disabled={!hasAccess || isSaving} onClick={hasAccess ? handleSave : () => router.push('/checkout?plan_id=student_premium')}>
            {hasAccess ? (
              isSaving ? t('saving') : t('create')
            ) : (
              <><Lock className="size-3" /> Upgrade</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
