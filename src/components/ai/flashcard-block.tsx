'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Layers, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface FlashcardData {
  front: string;
  back: string;
  topic?: string;
}

interface FlashcardBlockProps {
  flashcards: FlashcardData[];
}

export function FlashcardBlock({ flashcards }: FlashcardBlockProps) {
  const t = useTranslations('AiChatPage');
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const deckRes = await fetch('/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('flashcard_deck_name') }),
      });
      if (!deckRes.ok) throw new Error('Failed to create deck');
      const deckData = await deckRes.json();
      const deckId: string = deckData.data?.id;
      if (!deckId) throw new Error('No deck ID returned');

      for (const card of flashcards) {
        const cardRes = await fetch('/api/v1/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            front: card.front,
            back: card.back,
            deckId,
            ...(card.topic ? { topicIds: [card.topic] } : {}),
          }),
        });
        if (!cardRes.ok) throw new Error('Failed to create flashcard');
      }

      setSaved(true);
      toast.success(t('flashcard_deck_created', { count: flashcards.length }));
      router.push(`/app/flashcards/deck/${deckId}`);
    } catch {
      toast.error(t('flashcard_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-600 dark:text-green-400 mt-2">
        <Check className="h-4 w-4 shrink-0" />
        <span>{t('flashcard_saved', { count: flashcards.length })}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        <span>{t('flashcard_count', { count: flashcards.length })}</span>
      </div>
      <div className="space-y-1.5">
        {flashcards.slice(0, 3).map((card, i) => (
          <div key={i} className="rounded-lg border bg-background/60 p-2.5 text-xs">
            <div className="font-medium">{card.front}</div>
            <div className="text-muted-foreground mt-0.5">{card.back}</div>
            {card.topic && (
              <div className="text-xs text-muted-foreground/60 mt-0.5">{card.topic}</div>
            )}
          </div>
        ))}
        {flashcards.length > 3 && (
          <div className="text-xs text-muted-foreground text-center py-1">
            +{flashcards.length - 3} more
          </div>
        )}
      </div>
      <Button onClick={handleSave} disabled={saving} size="sm" variant="secondary" className="w-full">
        {saving ? (
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        ) : (
          <Layers className="mr-2 h-3 w-3" />
        )}
        {t('flashcard_save_deck', { count: flashcards.length })}
      </Button>
    </div>
  );
}
