'use client';

import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Table,
  Wand,
} from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { type RefObject, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function generateTableMarkdown(rows: number, cols: number): string {
  const headers = Array.from({ length: cols }, (_, i) => ` Header ${i + 1} `);
  const separators = Array.from({ length: cols }, () => '---');
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' Cell '));
  return [
    `|${headers.join('|')}|`,
    `|${separators.join('|')}|`,
    ...cells.map((row) => `|${row.join('|')}|`),
  ].join('\n');
}

interface MarkdownToolbarProps {
  t: ReturnType<typeof useTranslations>;
  uploading: boolean;
  onUploadClick: () => void;
  onFormat: () => void;
  wrap: (before: string, after: string, defaultText?: string) => void;
  insertText: (text: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function MarkdownToolbar({
  t,
  uploading,
  onUploadClick,
  onFormat,
  wrap,
  insertText,
  fileInputRef,
  onPickFile,
}: MarkdownToolbarProps) {
  const [tableSize, setTableSize] = useState({ rows: 1, cols: 1 });
  const [tableOpen, setTableOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 shrink-0">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onFormat}
          aria-label={t('toolbar_format')}
          title={t('toolbar_format')}
        >
          <Wand className="h-4 w-4" />
        </Button>
        <Popover open={tableOpen} onOpenChange={setTableOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('toolbar_table')}
              title={t('toolbar_table')}
            >
              <Table className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-auto p-3">
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: 49 }, (_, i) => {
                  const col = (i % 7) + 1;
                  const row = Math.floor(i / 7) + 1;
                  const isHighlighted = col <= tableSize.cols && row <= tableSize.rows;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={cn(
                        'h-5 w-5 rounded-sm border transition-colors',
                        isHighlighted
                          ? 'border-primary bg-primary/20'
                          : 'border-border hover:border-muted-foreground/40',
                      )}
                      onMouseEnter={() => setTableSize({ rows: row, cols: col })}
                      onClick={() => {
                        insertText(generateTableMarkdown(row, col));
                        setTableOpen(false);
                        setTableSize({ rows: 1, cols: 1 });
                      }}
                    />
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground text-center">
                {tableSize.cols} × {tableSize.rows}
              </div>
            </div>
          </PopoverContent>
        </Popover>
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
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
