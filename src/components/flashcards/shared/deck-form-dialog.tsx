'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { DIALOG_GRADIENT_HEX } from '@/lib/color-utils';

interface GroupOption {
  id: string;
  name: string;
}

interface DeckFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  } | null;
  onSubmit: (data: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }) => void;
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  cancelLabel: string;
  submitLabel: string;
  groups?: GroupOption[];
  visibilityLabel?: string;
  visibilityPersonalLabel?: string;
  visibilityGroupLabel?: string;
  groupsPlaceholder?: string;
  groupsEmptyText?: string;
}

function FormBody({
  gradient,
  initialValues,
  nameLabel,
  namePlaceholder,
  descriptionLabel,
  descriptionPlaceholder,
  cancelLabel,
  submitLabel,
  onSubmit,
  onCancel,
  groups,
  visibilityLabel,
  visibilityPersonalLabel,
  visibilityGroupLabel,
  groupsPlaceholder,
  groupsEmptyText,
}: {
  gradient: { from: string; to: string };
  initialValues?: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  } | null;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  cancelLabel: string;
  submitLabel: string;
  onSubmit: (data: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }) => void;
  onCancel: () => void;
  groups?: GroupOption[];
  visibilityLabel?: string;
  visibilityPersonalLabel?: string;
  visibilityGroupLabel?: string;
  groupsPlaceholder?: string;
  groupsEmptyText?: string;
}) {
  const [formData, setFormData] = useState(
    initialValues ?? { name: '', description: '', visibility: 'personal' as const, groupIds: [] },
  );
  const [visibility, setVisibility] = useState(formData.visibility ?? 'personal');
  const [groupIds, setGroupIds] = useState<string[]>(formData.groupIds ?? []);

  return (
    <>
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
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={namePlaceholder}
                className="text-lg font-bold tracking-tight h-auto py-0 px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
              />
              <label className="sr-only">{descriptionLabel}</label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder={descriptionPlaceholder}
                rows={2}
                className="text-sm text-muted-foreground resize-none px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
              />
            </div>
          </div>
        </Card>
        {groups && (
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{visibilityLabel}</Label>
              <RadioGroup
                value={visibility}
                onValueChange={(v: 'personal' | 'group') => setVisibility(v)}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="personal" id="visibility-personal" />
                  <Label htmlFor="visibility-personal" className="text-sm cursor-pointer">
                    {visibilityPersonalLabel}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="group" id="visibility-group" />
                  <Label htmlFor="visibility-group" className="text-sm cursor-pointer">
                    {visibilityGroupLabel}
                  </Label>
                </div>
              </RadioGroup>
            </div>
            {visibility === 'group' && (
              <MultiSelect
                options={groups.map((g) => ({ label: g.name, value: g.id }))}
                selected={groupIds}
                onChange={setGroupIds}
                placeholder={groupsPlaceholder}
                emptyText={groupsEmptyText}
              />
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button onClick={() => onSubmit({ ...formData, visibility, groupIds })}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DeckFormDialog({
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
  groups,
  visibilityLabel,
  visibilityPersonalLabel,
  visibilityGroupLabel,
  groupsPlaceholder,
  groupsEmptyText,
}: DeckFormDialogProps) {
  const gradient = DIALOG_GRADIENT_HEX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormBody
          gradient={gradient}
          initialValues={initialValues}
          nameLabel={nameLabel}
          namePlaceholder={namePlaceholder}
          descriptionLabel={descriptionLabel}
          descriptionPlaceholder={descriptionPlaceholder}
          cancelLabel={cancelLabel}
          submitLabel={submitLabel}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          groups={groups}
          visibilityLabel={visibilityLabel}
          visibilityPersonalLabel={visibilityPersonalLabel}
          visibilityGroupLabel={visibilityGroupLabel}
          groupsPlaceholder={groupsPlaceholder}
          groupsEmptyText={groupsEmptyText}
        />
      </DialogContent>
    </Dialog>
  );
}
