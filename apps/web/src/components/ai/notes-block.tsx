'use client';

import type { NotesItem } from '@studiq/server/services/ai-utils';
import { Button } from '@studiq/ui';
import { Copy, Layers, NotebookText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type DeckTarget, FlashcardBlock } from '@/components/ai/flashcard-block';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { notesToFlashcards, notesToMarkdown } from '@/lib/ai-notes';

interface NotesBlockProps {
  notes: NotesItem;
  targetDeck?: DeckTarget | null;
}

/**
 * Study notes the assistant wrote (`generate_notes`): the sections in reading order, the key terms
 * and the summary. Copy-only: nothing is stored. "Make flashcards" hands the key terms to the
 * flashcard block, which owns the one save path, so nothing is written until the user saves there.
 */
export function NotesBlock({ notes, targetDeck }: NotesBlockProps) {
  const t = useTranslations('AiChatPage');
  const [showCards, setShowCards] = useState(false);
  const cards = notesToFlashcards(notes);
  const title = notes.title || t('notes_untitled');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        notesToMarkdown(notes, { keyTerms: t('notes_key_terms'), summary: t('notes_summary') }),
      );
      toast.success(t('notes_copied'));
    } catch {
      toast.error(t('notes_copy_failed'));
    }
  };

  return (
    <div className="mt-2 space-y-3">
      <section aria-label={title} className="space-y-3 rounded-lg border bg-background/60 p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <NotebookText className="h-4 w-4 shrink-0 text-muted-foreground" />
          {title}
        </h3>

        {notes.sections.map((section, index) => (
          <div key={index} className="space-y-1">
            {section.heading && <h4 className="text-xs font-semibold">{section.heading}</h4>}
            {section.content && <MarkdownRenderer content={section.content} />}
          </div>
        ))}

        {notes.keyTerms.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold">{t('notes_key_terms')}</h4>
            <dl className="space-y-1 text-xs">
              {notes.keyTerms.map((entry, index) => (
                <div key={index}>
                  <dt className="inline font-medium">{entry.term}</dt>
                  {entry.definition && (
                    <dd className="inline text-muted-foreground"> — {entry.definition}</dd>
                  )}
                </div>
              ))}
            </dl>
          </div>
        )}

        {notes.summary && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold">{t('notes_summary')}</h4>
            <p className="text-xs text-muted-foreground">{notes.summary}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()}>
            <Copy className="mr-2 h-3 w-3" />
            {t('notes_copy')}
          </Button>
          {cards.length > 0 && !showCards && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowCards(true)}>
              <Layers className="mr-2 h-3 w-3" />
              {t('notes_make_flashcards')}
            </Button>
          )}
        </div>
      </section>

      {showCards && <FlashcardBlock flashcards={cards} deckName={title} targetDeck={targetDeck} />}
    </div>
  );
}
