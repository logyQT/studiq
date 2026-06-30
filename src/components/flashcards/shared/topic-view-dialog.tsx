'use client';

import type { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getGradientHex } from '@/lib/color-utils';
import type { Flashcard, Topic } from '@/types/flashcards';

interface TopicViewDialogProps {
  viewTopic: Topic | undefined;
  viewFlashcards: Flashcard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: ReturnType<typeof useTranslations>;
}

export function TopicViewDialog({
  viewTopic,
  viewFlashcards,
  open,
  onOpenChange,
  t,
}: TopicViewDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {viewTopic && (
              <span className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id="view-tag-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={getGradientHex(viewTopic.name).from} />
                        <stop offset="100%" stopColor={getGradientHex(viewTopic.name).to} />
                      </linearGradient>
                    </defs>
                    <path
                      d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2z"
                      stroke="url(#view-tag-grad)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="7" cy="7" r="1.5" fill="url(#view-tag-grad)" />
                  </svg>
                </div>
                {viewTopic.name}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('view_flashcards_count', { count: viewFlashcards.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {viewFlashcards.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t('no_flashcards_for_topic')}</p>
          ) : (
            viewFlashcards.map((fc) => (
              <div key={fc.id} className="p-4 rounded-lg border space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">{t('question_label')}</p>
                  <p className="text-sm font-medium">
                    <MarkdownRenderer content={fc.front} />
                  </p>
                </div>
                <div className="border-t pt-2">
                  <p className="text-xs text-muted-foreground uppercase">{t('answer_label')}</p>
                  <p className="text-sm">
                    <MarkdownRenderer content={fc.back} />
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('common_close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
