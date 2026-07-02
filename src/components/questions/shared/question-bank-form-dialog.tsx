'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';

interface QuestionBankFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: { name: string; description: string } | null;
  onSubmit: (data: { name: string; description: string }) => void;
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  cancelLabel: string;
  submitLabel: string;
}

export function QuestionBankFormDialog({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  title,
  description,
  nameLabel,
  namePlaceholder,
  descriptionLabel,
  descriptionPlaceholder,
  cancelLabel,
  submitLabel,
}: QuestionBankFormDialogProps) {
  const [name, setName] = useState('');
  const [bankDescription, setBankDescription] = useState('');

  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '');
      setBankDescription(initialValues?.description ?? '');
    }
  }, [open, initialValues]);

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: bankDescription.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="bank-name">{nameLabel}</Label>
            <Input
              id="bank-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bank-desc">{descriptionLabel}</Label>
            <Textarea
              id="bank-desc"
              value={bankDescription}
              onChange={(e) => setBankDescription(e.target.value)}
              placeholder={descriptionPlaceholder}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={handleSubmit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
