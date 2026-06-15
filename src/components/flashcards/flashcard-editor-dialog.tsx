'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { FlashcardEditor } from '@/components/flashcards/flashcard-editor';
import type { Topic } from '@/types/flashcards';
import type { useTranslations } from 'next-intl';

interface FlashcardEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  front: string;
  back: string;
  topicIds: string[];
  topics: Topic[];
  onFrontChange: (value: string) => void;
  onBackChange: (value: string) => void;
  onTopicIdsChange: (ids: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  t: ReturnType<typeof useTranslations<'AppFlashcardDeckViewPage'>>;
}

export function FlashcardEditorDialog({
  open,
  onOpenChange,
  mode,
  front,
  back,
  topicIds,
  topics,
  onFrontChange,
  onBackChange,
  onTopicIdsChange,
  onSave,
  onCancel,
  saving,
  t,
}: FlashcardEditorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        onCancel();
      }
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onCancel]);

  if (!open) return null;

  const topicOptions = topics.map((t) => ({ label: t.name, value: t.id }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        className="relative z-50 mx-auto flex h-[90vh] w-[80vw] flex-col overflow-hidden rounded-2xl border bg-background/95 backdrop-blur-xl shadow-2xl supports-[backdrop-filter]:bg-background/60"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            {mode === 'create' ? t('create_title') : t('edit_title')}
          </h2>
          <button
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col p-6">
          <FlashcardEditor
            front={front}
            back={back}
            onFrontChange={onFrontChange}
            onBackChange={onBackChange}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <MultiSelect
            options={topicOptions}
            selected={topicIds}
            onChange={onTopicIdsChange}
            placeholder={t('topics_placeholder')}
            className="flex-1"
          />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving
                ? t('saving')
                : mode === 'create'
                  ? t('create')
                  : t('update')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
