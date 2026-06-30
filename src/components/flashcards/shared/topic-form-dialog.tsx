'use client';

import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DIALOG_GRADIENT_HEX } from '@/lib/color-utils';
import type { Topic } from '@/types/flashcards';

interface TopicFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Topic | null;
  formData: { name: string };
  onFormDataChange: (data: { name: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function TopicFormDialog({
  open,
  onOpenChange,
  editing,
  formData,
  onFormDataChange,
  onSubmit,
  onCancel,
  t,
}: TopicFormDialogProps) {
  const gradient = DIALOG_GRADIENT_HEX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('edit_title') : t('new_topic_title')}</DialogTitle>
          <DialogDescription>{editing ? t('edit_desc') : t('new_topic_desc')}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Card className="p-5 pb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center shrink-0">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="dialog-tag-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={gradient.from} />
                      <stop offset="100%" stopColor={gradient.to} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2z"
                    stroke="url(#dialog-tag-grad)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="7" cy="7" r="1.5" fill="url(#dialog-tag-grad)" />
                </svg>
              </div>
              <div className="flex-1">
                <label className="sr-only">{t('topic_name_label')}</label>
                <Input
                  value={formData.name}
                  onChange={(e) => onFormDataChange({ name: e.target.value })}
                  placeholder={t('topic_name_placeholder')}
                  className="text-lg font-bold tracking-tight h-auto py-0 px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
                />
              </div>
            </div>
          </Card>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common_cancel')}
          </Button>
          <Button onClick={onSubmit}>{editing ? t('common_update') : t('common_create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
