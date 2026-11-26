'use client';

import { Button, Checkbox, Input } from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Layers, Loader2, Pencil } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { GeneratedCards, type FlashcardData } from '@/components/ai/generated-cards';
import { describeSaveFailure, planTopicGroups, saveCards } from '@/lib/ai-chat-flashcard-topics';
import { apiPost } from '@/lib/api';
import { flashcardKeys, topicKeys } from '@/lib/query-keys';

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
  const [name, setName] = useState(deckName?.trim() || t('flashcard_deck_name'));
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());

  const [keepTopics, setKeepTopics] = useState(true);
  const keepTopicsId = useId();
  /** Cards that a save confirmed. The next save skips them. */
  const [savedIndices, setSavedIndices] = useState<ReadonlySet<number>>(new Set<number>());
  /** The deck of a failed save that has cards, or can have them. The next save uses it. */
  const [keptDeckId, setKeptDeckId] = useState<string | null>(null);

  const unsavedCount = flashcards.filter(
    (_, i) => !removedIndices.has(i) && !savedIndices.has(i),
  ).length;
  const removedCount = removedIndices.size;
  const topicNames = planTopicGroups(flashcards, removedIndices, []).flatMap(
    (group) => group.name ?? [],
  );

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
    if (unsavedCount === 0) return;
    setSaving(true);
    const saved = new Set(savedIndices);
    let deckId = targetDeck?.id ?? keptDeckId;
    try {
      if (!deckId) {
        const deck = await apiPost<{ id: string }>('/api/v1/flashcards/decks', { name });
        if (!deck.id) throw new Error('No deck ID returned');
        deckId = deck.id;
      }

      const { topicCount, topicsFailed } = await saveCards({
        deckId,
        cards: flashcards,
        skipped: new Set([...removedIndices, ...saved]),
        keepTopics,
        onSaved: (indices) => {
          for (const index of indices) saved.add(index);
          setSavedIndices(new Set(saved));
        },
      });

      setSavedDeckId(deckId);
      if (topicsFailed) {
        toast.warning(t('flashcard_topics_failed'));
      } else if (topicCount > 0) {
        toast.success(t('flashcard_saved_with_topics', { count: saved.size, topics: topicCount }));
      } else {
        toast.success(
          targetDeck
            ? t('flashcard_saved', { count: saved.size })
            : t('flashcard_deck_created', { count: saved.size }),
        );
      }
    } catch (error) {
      const { messageKey, keepDeck } = describeSaveFailure(error, saved.size, deckId !== null);
      // A deck without cards is not reused: the next save creates one with the current name.
      if (keepDeck) setKeptDeckId(deckId);
      toast.error(t(messageKey, { count: saved.size }));
    } finally {
      // Deck, card and topic lists are cached with `staleTime: Infinity`, and a
      // failed save may still have written some of them.
      void queryClient.invalidateQueries({ queryKey: flashcardKeys.all });
      void queryClient.invalidateQueries({ queryKey: topicKeys.all });
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

  const deckLink = (id: string) => (
    <a
      href={`${deckBasePath}/flashcards/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
    >
      {t('open_deck')}
      <ExternalLink className="h-3 w-3" />
    </a>
  );

  if (savedDeckId) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
          <Check className="h-4 w-4 shrink-0" />
          <span>{t('flashcard_saved', { count: savedIndices.size })}</span>
        </div>
        {deckLink(savedDeckId)}
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
        tools={
          !readOnly && (
            <div className="space-y-2">
              {targetDeck ? (
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
                    disabled={keptDeckId !== null}
                    className="h-7 text-xs"
                    placeholder={t('flashcard_deck_name')}
                  />
                </div>
              )}
              {topicNames.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <Checkbox
                    id={keepTopicsId}
                    checked={keepTopics}
                    onCheckedChange={(checked) => setKeepTopics(checked === true)}
                    disabled={saving}
                    className="mt-px"
                  />
                  <div className="min-w-0">
                    <label htmlFor={keepTopicsId} className="font-medium">
                      {t('flashcard_keep_topics', { count: topicNames.length })}
                    </label>
                    <p className="wrap-break-word text-muted-foreground">{topicNames.join(', ')}</p>
                  </div>
                </div>
              )}
            </div>
          )
        }
        onToggleCard={toggleRemove}
        toggleLabels={{ remove: t('remove_card'), keep: t('keep_card') }}
      />

      {keptDeckId && deckLink(keptDeckId)}

      {!readOnly && (
        <Button
          onClick={handleSave}
          disabled={saving || unsavedCount === 0}
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
            ? t('flashcard_save_into_deck', { count: unsavedCount })
            : t('flashcard_save_deck', { count: unsavedCount })}
        </Button>
      )}
    </div>
  );
}
