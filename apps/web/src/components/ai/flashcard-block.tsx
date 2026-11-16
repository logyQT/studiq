'use client';

import { Button, Input } from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Layers, Loader2, Pencil } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { GeneratedCards, type FlashcardData } from '@/components/ai/generated-cards';
import { apiPost } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';

/** Deck the generated cards are saved into, when the chat was opened from a deck. */
export interface DeckTarget {
  id: string;
  name: string;
}

interface FlashcardBlockProps {
  flashcards?: FlashcardData[];
  deckName?: string;
  loading?: boolean;
  count?: number;
  readOnly?: boolean;
  targetDeck?: DeckTarget | null;
}

export function FlashcardBlock({
  flashcards = [],
  deckName,
  loading = false,
  count,
  readOnly = false,
  targetDeck,
}: FlashcardBlockProps) {
  const t = useTranslations('AiChatPage');
  const pathname = usePathname();
  const queryClient = useQueryClient();
  // The AI chat is reachable from both the student and the educator dashboards,
  // so the saved-deck link has to stay inside the current dashboard.
  const deckBasePath = pathname.startsWith('/edu') ? '/edu' : '/app';
  const [saving, setSaving] = useState(false);
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
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
      let deckId = targetDeck?.id;
      const createdNewDeck = !deckId;
      if (!deckId) {
        const deck = await apiPost<{ id: string }>('/api/v1/flashcards/decks', { name });
        deckId = deck.id;
        if (!deckId) throw new Error('No deck ID returned');
      }

      await apiPost<unknown>('/api/v1/flashcards/batch/create', {
        cards: visibleCards.map((c) => ({ front: c.front, back: c.back })),
        deckId,
      });

      setSavedDeckId(deckId);
      // Deck and card lists are cached with `staleTime: Infinity`; without this
      // the deck the user returns to keeps showing the old card count.
      void queryClient.invalidateQueries({ queryKey: flashcardKeys.all });
      toast.success(
        createdNewDeck
          ? t('flashcard_deck_created', { count: visibleCards.length })
          : t('flashcard_saved', { count: visibleCards.length }),
      );
    } catch {
      toast.error(t('flashcard_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    const skeletonCount = count || 6;
    return (
      <div className="mt-2 animate-pulse space-y-3">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-lg border bg-background/60 p-2.5">
              <div className="h-3 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
              <div className="h-2 w-1/3 rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="h-8 w-full rounded-md bg-muted" />
      </div>
    );
  }

  if (savedDeckId) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
          <Check className="h-4 w-4 shrink-0" />
          <span>{t('flashcard_saved', { count: visibleCards.length })}</span>
        </div>
        <a
          href={`${deckBasePath}/flashcards/${savedDeckId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          {t('open_deck')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <GeneratedCards
        cards={flashcards}
        label={
          readOnly
            ? t('flashcards_preview', { count: flashcards.length })
            : t('flashcards_generated', { count: flashcards.length })
        }
        note={
          <>
            {readOnly && (
              <span className="ml-auto text-[10px] text-muted-foreground/40 italic">
                awaiting approval
              </span>
            )}
            {removedCount > 0 && (
              <span className="text-xs text-muted-foreground/60">({removedCount} removed)</span>
            )}
          </>
        }
        removed={removedIndices}
        onToggleCard={readOnly ? undefined : toggleRemove}
        toggleLabels={{ remove: t('remove_card'), keep: t('keep_card') }}
      />

      {!readOnly &&
        (targetDeck ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Layers className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <span className="truncate">
              {t('flashcard_saving_to_deck', { deck: targetDeck.name })}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-xs"
              placeholder={t('flashcard_deck_name')}
            />
          </div>
        ))}

      {!readOnly && (
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
          {targetDeck
            ? t('flashcard_save_into_deck', { count: visibleCards.length })
            : t('flashcard_save_deck', { count: visibleCards.length })}
        </Button>
      )}
    </div>
  );
}
