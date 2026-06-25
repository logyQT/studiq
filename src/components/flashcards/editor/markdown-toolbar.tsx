'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Image,
  Eye,
  Pen,
  Loader2,
} from 'lucide-react';
import { type RefObject } from 'react';

interface MarkdownToolbarProps {
  t: ReturnType<typeof useTranslations>;
  preview: boolean;
  onPreviewChange: (preview: boolean) => void;
  uploading: boolean;
  onUploadClick: () => void;
  wrap: (before: string, after: string, defaultText?: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function MarkdownToolbar({
  t,
  preview,
  onPreviewChange,
  uploading,
  onUploadClick,
  wrap,
  fileInputRef,
  onPickFile,
}: MarkdownToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 shrink-0">
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg border bg-muted/50 p-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('**', '**', 'bold')}
          aria-label={t('toolbar_bold')}
          title={t('toolbar_bold')}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('*', '*', 'italic')}
          aria-label={t('toolbar_italic')}
          title={t('toolbar_italic')}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('# ', '')}
          aria-label={t('toolbar_heading1')}
          title={t('toolbar_heading1')}
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('## ', '')}
          aria-label={t('toolbar_heading2')}
          title={t('toolbar_heading2')}
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('### ', '')}
          aria-label={t('toolbar_heading3')}
          title={t('toolbar_heading3')}
        >
          <Heading3 className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('- ', '')}
          aria-label={t('toolbar_bullet_list')}
          title={t('toolbar_bullet_list')}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => wrap('1. ', '')}
          aria-label={t('toolbar_ordered_list')}
          title={t('toolbar_ordered_list')}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg"
          className="hidden"
          onChange={onPickFile}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onUploadClick}
          disabled={uploading}
          aria-label={t('toolbar_upload_media')}
          title={t('toolbar_upload_media')}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Image className="h-4 w-4" />
          )}
        </Button>
      </div>
      <Toggle
        pressed={preview}
        onPressedChange={onPreviewChange}
        aria-label={preview ? t('toolbar_edit') : t('toolbar_preview')}
        title={preview ? t('toolbar_edit') : t('toolbar_preview')}
        size="sm"
        className="gap-1 shrink-0"
      >
        {preview ? <Pen className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        <span className="text-xs">{preview ? t('toolbar_edit') : t('toolbar_preview')}</span>
      </Toggle>
    </div>
  );
}
