'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('edit_title') : t('new_topic_title')}</DialogTitle>
          <DialogDescription>{editing ? t('edit_desc') : t('new_topic_desc')}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="topic-name">{t('topic_name_label')}</Label>
          <Input
            id="topic-name"
            value={formData.name}
            onChange={(e) => onFormDataChange({ name: e.target.value })}
            placeholder={t('topic_name_placeholder')}
            className="mt-2"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common_cancel')}
          </Button>
          <Button onClick={onSubmit}>
            {editing ? t('common_update') : t('common_create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
