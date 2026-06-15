'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Link,
  Image,
  Eye,
  Pen,
  Loader2,
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { apiUploadFile } from '@/lib/api';
import { useTranslations } from 'next-intl';

interface FlashcardEditorProps {
  front: string;
  back: string;
  onFrontChange: (value: string) => void;
  onBackChange: (value: string) => void;
}

function wrapSelection(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  onChange: (v: string) => void,
  before: string,
  after: string,
  defaultText?: string,
) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = currentValue.substring(start, end) || defaultText || '';
  const replacement = before + selected + after;
  const newValue = currentValue.substring(0, start) + replacement + currentValue.substring(end);
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
}

function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  onChange: (v: string) => void,
  text: string,
) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + text.length, start + text.length);
  });
}

export function FlashcardEditor({
  front,
  back,
  onFrontChange,
  onBackChange,
}: FlashcardEditorProps) {
  const t = useTranslations('FlashcardEditorComponent');
  const [preview, setPreview] = useState(false);
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [uploading, setUploading] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTextarea = activeSide === 'front' ? frontRef.current : backRef.current;
  const activeValue = activeSide === 'front' ? front : back;
  const activeOnChange = activeSide === 'front' ? onFrontChange : onBackChange;

  const wrap = useCallback(
    (before: string, after: string, defaultText?: string) => {
      wrapSelection(activeTextarea, activeValue, activeOnChange, before, after, defaultText);
    },
    [activeTextarea, activeValue, activeOnChange],
  );

  const addLink = useCallback(() => {
    const url = window.prompt(t('link_url_prompt'), 'https://');
    if (!url) return;
    if (!activeTextarea) return;
    const start = activeTextarea.selectionStart;
    const end = activeTextarea.selectionEnd;
    const selected = activeValue.substring(start, end) || t('link_default_text');
    const replacement = `[${selected}](${url})`;
    const newValue = activeValue.substring(0, start) + replacement + activeValue.substring(end);
    activeOnChange(newValue);
    requestAnimationFrame(() => {
      activeTextarea.focus();
      activeTextarea.setSelectionRange(start + 1, start + 1 + selected.length);
    });
  }, [activeTextarea, activeValue, activeOnChange, t]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await apiUploadFile<{ url: string }>('/api/v1/flashcards/media/upload', file);
      const isAudio = file.type.startsWith('audio/');
      if (isAudio) {
        insertAtCursor(activeTextarea, activeValue, activeOnChange, `<audio controls src="${result.url}"></audio>`);
      } else {
        const name = file.name.replace(/\.[^.]+$/, '');
        insertAtCursor(activeTextarea, activeValue, activeOnChange, `![${name}](${result.url})`);
      }
    } finally {
      setUploading(false);
    }
  }, [activeTextarea, activeValue, activeOnChange]);

  const handlePickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  }, [handleUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  return (
    <div
      className="flex flex-col gap-4 flex-1 min-h-0"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg border bg-muted/50 p-1">
          <Toggle onClick={() => wrap('**', '**', 'bold')} aria-label={t('toolbar_bold')} title={t('toolbar_bold')} size="sm">
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('*', '*', 'italic')} aria-label={t('toolbar_italic')} title={t('toolbar_italic')} size="sm">
            <Italic className="h-4 w-4" />
          </Toggle>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Toggle onClick={() => wrap('# ', '')} aria-label={t('toolbar_heading1')} title={t('toolbar_heading1')} size="sm">
            <Heading1 className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('## ', '')} aria-label={t('toolbar_heading2')} title={t('toolbar_heading2')} size="sm">
            <Heading2 className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('### ', '')} aria-label={t('toolbar_heading3')} title={t('toolbar_heading3')} size="sm">
            <Heading3 className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('#### ', '')} aria-label={t('toolbar_heading4')} title={t('toolbar_heading4')} size="sm">
            <Heading4 className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('##### ', '')} aria-label={t('toolbar_heading5')} title={t('toolbar_heading5')} size="sm">
            <Heading5 className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('###### ', '')} aria-label={t('toolbar_heading6')} title={t('toolbar_heading6')} size="sm">
            <Heading6 className="h-4 w-4" />
          </Toggle>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Toggle onClick={() => wrap('- ', '')} aria-label={t('toolbar_bullet_list')} title={t('toolbar_bullet_list')} size="sm">
            <List className="h-4 w-4" />
          </Toggle>
          <Toggle onClick={() => wrap('1. ', '')} aria-label={t('toolbar_ordered_list')} title={t('toolbar_ordered_list')} size="sm">
            <ListOrdered className="h-4 w-4" />
          </Toggle>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Toggle onClick={addLink} aria-label={t('toolbar_link')} title={t('toolbar_link')} size="sm">
            <Link className="h-4 w-4" />
          </Toggle>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg"
            className="hidden"
            onChange={handlePickFile}
          />
          <Toggle
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label={t('toolbar_upload_media')}
            title={t('toolbar_upload_media')}
            size="sm"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
          </Toggle>
        </div>
        <Toggle
          pressed={preview}
          onPressedChange={setPreview}
          aria-label={preview ? t('toolbar_edit') : t('toolbar_preview')}
          title={preview ? t('toolbar_edit') : t('toolbar_preview')}
          size="sm"
          className="gap-1 shrink-0"
        >
          {preview ? <Pen className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span className="text-xs">{preview ? t('toolbar_edit') : t('toolbar_preview')}</span>
        </Toggle>
      </div>

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
              className="flex-1 min-h-0 w-full resize-none rounded-lg border bg-background p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
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
              className="flex-1 min-h-0 w-full resize-none rounded-lg border bg-background p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('back_placeholder')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
