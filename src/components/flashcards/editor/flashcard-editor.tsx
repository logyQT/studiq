'use client';

import { useTranslations } from 'next-intl';
import { MarkdownToolbar } from '@/components/flashcards/editor/markdown-toolbar';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { useMarkdownEditor } from '@/hooks/use-markdown-editor';

interface FlashcardEditorProps {
  front: string;
  back: string;
  onFrontChange: (value: string) => void;
  onBackChange: (value: string) => void;
}

export function FlashcardEditor({
  front,
  back,
  onFrontChange,
  onBackChange,
}: FlashcardEditorProps) {
  const t = useTranslations('FlashcardEditorComponent');
  const {
    preview,
    setPreview,
    setActiveSide,
    uploading,
    isDragOver,
    wrap,
    handlePickFile,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    frontRef,
    backRef,
    fileInputRef,
  } = useMarkdownEditor(front, back, onFrontChange, onBackChange);

  return (
    <div
      className={`flex flex-col gap-4 flex-1 min-h-0 transition-colors ${
        isDragOver ? 'rounded-lg border-2 border-dashed border-primary bg-primary/5' : ''
      }`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <MarkdownToolbar
        t={t}
        preview={preview}
        onPreviewChange={setPreview}
        uploading={uploading}
        onUploadClick={() => fileInputRef.current?.click()}
        wrap={wrap}
        fileInputRef={fileInputRef}
        onPickFile={handlePickFile}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 min-h-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
            {t('front_label')}
          </div>
          {preview ? (
            <div className="flex-1 min-h-0 rounded-lg border bg-background p-4 overflow-y-auto">
              <MarkdownRenderer content={front} />
            </div>
          ) : (
            <textarea
              ref={frontRef}
              value={front}
              onChange={(e) => onFrontChange(e.target.value)}
              onFocus={() => setActiveSide('front')}
              className="flex-1 min-h-30 w-full resize-none rounded-lg border bg-background p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('front_placeholder')}
            />
          )}
        </div>

        <div className="flex flex-col gap-2 min-h-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
            {t('back_label')}
          </div>
          {preview ? (
            <div className="flex-1 min-h-0 rounded-lg border bg-background p-4 overflow-y-auto">
              <MarkdownRenderer content={back} />
            </div>
          ) : (
            <textarea
              ref={backRef}
              value={back}
              onChange={(e) => onBackChange(e.target.value)}
              onFocus={() => setActiveSide('back')}
              className="flex-1 min-h-30 w-full resize-none rounded-lg border bg-background p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('back_placeholder')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
