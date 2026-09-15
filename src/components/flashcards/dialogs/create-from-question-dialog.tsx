'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { apiPost } from '@/lib/api';
import type { Deck, Question } from '@/server/models';

function deriveBack(question: Question): string {
  const correct = question.question_answers?.filter((a) => a.is_correct).map((a) => a.content);
  if (correct && correct.length > 0) return correct.join(', ');
  return question.explanation ?? '';
}

interface CreateFromQuestionDialogProps {
  question: Question | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateFromQuestionDialog({
  question,
  open,
  onOpenChange,
}: CreateFromQuestionDialogProps) {
  const t = useTranslations('CreateFlashcardFromQuestion');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [deckId, setDeckId] = useState<string>('');

  const { data: decksResult } = useApiQuery<{ items: Deck[] }>({
    queryKey: ['flashcards', 'decks', 'owned-limit-200'],
    url: '/api/v1/flashcards/decks?limit=200',
    enabled: open,
  });
  const decks = decksResult?.items ?? [];

  useEffect(() => {
    if (question) {
      setFront(question.content);
      setBack(deriveBack(question));
    }
  }, [question]);

  const create = useApiMutation<unknown, void>({
    mutationFn: () =>
      apiPost('/api/v1/flashcards', {
        deckId,
        front,
        back,
        questionId: question?.id,
      }),
    invalidateKeys: [['flashcards']],
  });

  function handleSubmit() {
    if (!front.trim() || !back.trim() || !deckId) return;
    create.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('created'));
        onOpenChange(false);
      },
      onError: () => toast.error(t('error')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('deck_label')}</Label>
            <Select value={deckId} onValueChange={setDeckId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('deck_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {decks.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('front_label')}</Label>
            <Textarea value={front} onChange={(e) => setFront(e.target.value)} rows={3} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('back_label')}</Label>
            <Textarea value={back} onChange={(e) => setBack(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!front.trim() || !back.trim() || !deckId || create.isPending}
          >
            {t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
