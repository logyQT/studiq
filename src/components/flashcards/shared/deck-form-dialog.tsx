'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { DIALOG_GRADIENT_HEX } from '@/lib/color-utils';

interface DeckFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: { name: string; description: string };
  onFormDataChange: (data: { name: string; description: string }) => void;
  onSubmit: () => void;
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  cancelLabel: string;
  submitLabel: string;
}

export function DeckFormDialog({
  open,
  onOpenChange,
  formData,
  onFormDataChange,
  onSubmit,
  title,
  description,
  nameLabel,
  namePlaceholder,
  descriptionLabel,
  descriptionPlaceholder,
  cancelLabel,
  submitLabel,
}: DeckFormDialogProps) {
  const gradient = DIALOG_GRADIENT_HEX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Card className="p-5 pb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center shrink-0">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="dialog-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={gradient.from} />
                      <stop offset="100%" stopColor={gradient.to} />
                    </linearGradient>
                  </defs>
                  <path
                    d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                    stroke="url(#dialog-grad)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="flex-1 space-y-3">
                <label className="sr-only">{nameLabel}</label>
                <Input
                  value={formData.name}
                  onChange={(e) => onFormDataChange({ ...formData, name: e.target.value })}
                  placeholder={namePlaceholder}
                  className="text-lg font-bold tracking-tight h-auto py-0 px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
                />
                <label className="sr-only">{descriptionLabel}</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    onFormDataChange({
                      ...formData,
                      description: e.target.value,
                    })
                  }
                  placeholder={descriptionPlaceholder}
                  rows={2}
                  className="text-sm text-muted-foreground resize-none px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
                />
              </div>
            </div>
          </Card>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={onSubmit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
