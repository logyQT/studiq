'use client';

import type { Flashcard } from '@studiq/server/models/flashcard.model';
import type { Topic } from '@studiq/server/models/topic.model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  MultiSelect,
} from '@studiq/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MarkdownToolbar } from '@/components/flashcards/editor/markdown-toolbar';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { useDebounce } from '@/hooks/use-debounce';
import { useMarkdownEditor } from '@/hooks/use-markdown-editor';
import { apiPost, apiPut } from '@/lib/api';
import { formatMarkdown } from '@/lib/format-markdown';
import { flashcardKeys } from '@/lib/query-keys';

interface CreateCardDialogProps {
  deckId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  flashcard?: Flashcard | null;
  onSuccess?: () => void;
}

export function CreateCardDialog({
  deckId,
  open,
  onOpenChange,
  topics,
  flashcard,
  onSuccess,
}: CreateCardDialogProps) {
  const isEdit = !!flashcard;
  const t = useTranslations('AppFlashcardDeckViewPage');
  const editorT = useTranslations('FlashcardEditorComponent');
  const queryClient = useQueryClient();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);

  const {
    setActiveSide,
    uploading,
    wrap,
    insertText,
    formatBothSides,
    handlePickFile,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    frontRef,
    backRef,
    fileInputRef,
  } = useMarkdownEditor(front, back, setFront, setBack);

  const debouncedFront = useDebounce(front, 300);
  const debouncedBack = useDebounce(back, 300);

  useEffect(() => {
    if (open) {
      setFront(flashcard?.front ?? '');
      setBack(flashcard?.back ?? '');
      setTopicIds(flashcard?.flashcard_topic_assignments?.map((a) => a.topic_id) ?? []);
    }
  }, [open, flashcard]);

  const saveFlashcard = useMutation({
    mutationFn: (data: { front: string; back: string; topicIds?: string[] }) =>
      flashcard
        ? apiPut(`/api/v1/flashcards/${flashcard.id}`, data)
        : apiPost('/api/v1/flashcards', { ...data, deckId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcards', deckId] });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.detail(deckId) });
      toast.success(t(isEdit ? 'flashcard_updated' : 'flashcard_created'));
      onOpenChange(false);
      onSuccess?.();
      setFront('');
      setBack('');
      setTopicIds([]);
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
    await saveFlashcard.mutateAsync({
      front: formatMarkdown(front),
      back: formatMarkdown(back),
      topicIds: topicIds.length > 0 ? topicIds : undefined,
    });
  }

  const topicOptions = topics.map((topic) => ({ label: topic.name, value: topic.id }));
  const isSaving = saveFlashcard.isPending;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSaving) return;
    if (!nextOpen) {
      setFront('');
      setBack('');
      setTopicIds([]);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl sm:max-w-6xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? 'edit_card_dialog_title' : 'create_card_dialog_title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t(isEdit ? 'edit_card_dialog_desc' : 'create_card_dialog_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 grid grid-cols-[1.5fr_1fr] gap-6 overflow-hidden">
          <div
            className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <MarkdownToolbar
              t={editorT}
              uploading={uploading}
              onUploadClick={() => fileInputRef.current?.click()}
              onFormat={formatBothSides}
              wrap={wrap}
              insertText={insertText}
              fileInputRef={fileInputRef}
              onPickFile={handlePickFile}
            />

            <div className="space-y-1 flex-1 min-h-0 flex flex-col">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('question_label')}
              </span>
              <textarea
                ref={frontRef}
                value={front}
                onChange={(e) => setFront(e.target.value)}
                onFocus={() => setActiveSide('front')}
                className="flex-1 min-h-32 w-full resize-none rounded-lg border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder={editorT('front_placeholder')}
              />
            </div>

            <div className="space-y-1 flex-1 min-h-0 flex flex-col">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('answer_label')}
              </span>
              <textarea
                ref={backRef}
                value={back}
                onChange={(e) => setBack(e.target.value)}
                onFocus={() => setActiveSide('back')}
                className="flex-1 min-h-32 w-full resize-none rounded-lg border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder={editorT('back_placeholder')}
              />
            </div>

            <div className="shrink-0">
              <MultiSelect
                options={topicOptions}
                selected={topicIds}
                onChange={setTopicIds}
                placeholder={t('topics_placeholder')}
              />
            </div>

            <div className="flex items-center justify-end gap-2 shrink-0 pt-2 border-t sticky bottom-0 bg-background">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSaving}>
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('saving') : t(isEdit ? 'update' : 'create')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
            <div className="space-y-1 flex-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('question_label')}
              </span>
              <div className="rounded-2xl border bg-card shadow-md p-8 overflow-y-auto min-h-48 flex items-center justify-center text-center text-2xl font-medium">
                {debouncedFront ? (
                  <MarkdownRenderer content={debouncedFront} />
                ) : (
                  <span className="text-muted-foreground">...</span>
                )}
              </div>
            </div>
            <div className="space-y-1 flex-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('answer_label')}
              </span>
              <div className="rounded-2xl border bg-card shadow-md p-8 overflow-y-auto min-h-48 flex items-center justify-center text-center text-2xl font-medium">
                {debouncedBack ? (
                  <MarkdownRenderer content={debouncedBack} />
                ) : (
                  <span className="text-muted-foreground">...</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
