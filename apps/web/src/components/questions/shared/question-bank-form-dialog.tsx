'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MultiSelect,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@studiq/ui';
import { useEffect, useState } from 'react';

interface GroupOption {
  id: string;
  name: string;
}

interface QuestionBankFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: {
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
  groups,
  visibilityLabel,
  visibilityPersonalLabel,
  visibilityGroupLabel,
  groupsPlaceholder,
  groupsEmptyText,
}: QuestionBankFormDialogProps) {
  const [name, setName] = useState('');
  const [bankDescription, setBankDescription] = useState('');
  const [visibility, setVisibility] = useState<'personal' | 'group'>('personal');
  const [groupIds, setGroupIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '');
      setBankDescription(initialValues?.description ?? '');
      setVisibility(initialValues?.visibility ?? 'personal');
      setGroupIds(initialValues?.groupIds ?? []);
    }
  }, [open, initialValues]);

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: bankDescription.trim(), visibility, groupIds });
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
          {groups && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{visibilityLabel}</Label>
                <RadioGroup
                  value={visibility}
                  onValueChange={(v: 'personal' | 'group') => setVisibility(v)}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="personal" id="qb-visibility-personal" />
                    <Label htmlFor="qb-visibility-personal" className="text-sm cursor-pointer">
                      {visibilityPersonalLabel}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="group" id="qb-visibility-group" />
                    <Label htmlFor="qb-visibility-group" className="text-sm cursor-pointer">
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={handleSubmit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
