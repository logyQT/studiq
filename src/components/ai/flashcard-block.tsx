'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Layers, Loader2, Check, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FlashcardData {
  front: string;
  back: string;
  topic?: string;
}

interface FlashcardBlockProps {
  flashcards: FlashcardData[];
  deckName?: string;
}

export function FlashcardBlock({ flashcards, deckName }: FlashcardBlockProps) {
  const t = useTranslations('AiChatPage');
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(deckName || t('flashcard_deck_name'));
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());

  const visibleCards = flashcards.filter((_, i) => !removedIndices.has(i));
  const removedCount = removedIndices.size;

  const toggleRemove = (index: number) => {
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (visibleCards.length === 0) return;
    setSaving(true);
    try {
      const deckRes = await fetch('/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!deckRes.ok) throw new Error('Failed to create deck');
      const deckData = await deckRes.json();
      const deckId: string = deckData.data?.id;
      if (!deckId) throw new Error('No deck ID returned');

      const batchRes = await fetch('/api/v1/flashcards/batch/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: visibleCards.map((c) => ({ front: c.front, back: c.back })),
          deckIds: [deckId],
        }),
      });
      if (!batchRes.ok) throw new Error('Failed to create flashcards');

      setSaved(true);
      toast.success(t('flashcard_deck_created', { count: visibleCards.length }));
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
        <span>{t('flashcard_saved', { count: visibleCards.length })}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      {/* Deck name + count */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">
            {t('flashcards_generated', { count: flashcards.length })}
          </span>
          {removedCount > 0 && (
            <span className="text-xs text-muted-foreground/60">
              ({removedCount} removed)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Pencil className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-xs"
            placeholder={t('flashcard_deck_name')}
          />
        </div>
      </div>

      {/* Scrollable card grid */}
      <div className="max-h-[28rem] overflow-y-auto -mx-1 px-1">
        <div className="grid grid-cols-2 gap-2">
          {flashcards.map((card, i) => (
            <div
              key={i}
              className={cn(
                'group relative rounded-lg border bg-background/60 p-2.5 text-xs transition-opacity',
                removedIndices.has(i) && 'opacity-30'
              )}
            >
              {/* Delete toggle */}
              <button
                onClick={() => toggleRemove(i)}
                className={cn(
                  'absolute top-1.5 right-1.5 rounded-md p-1 transition-colors',
                  removedIndices.has(i)
                    ? 'text-green-500 hover:text-green-600 bg-green-500/10'
                    : 'text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100'
                )}
                title={removedIndices.has(i) ? t('keep_card') : t('remove_card')}
              >
                {removedIndices.has(i) ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </button>

              {/* Card content */}
              <div className="font-medium pr-5">{card.front}</div>
              <div className="text-muted-foreground mt-0.5">{card.back}</div>
              {card.topic && (
                <Badge variant="secondary" className="mt-1 text-[10px] px-1.5 py-0">
                  {card.topic}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Save button */}
      <Button
        onClick={handleSave}
        disabled={saving || visibleCards.length === 0}
        size="sm"
        variant="secondary"
        className="w-full"
      >
        {saving ? (
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        ) : (
          <Layers className="mr-2 h-3 w-3" />
        )}
        {t('flashcard_save_deck', { count: visibleCards.length })}
      </Button>
    </div>
  );
}
