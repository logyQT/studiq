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
import { useState } from 'react';
import type { ContentFormDialogProps } from '@/components/shared/content-form-dialog-props';
import { contentFormPayload } from '@/lib/share-fields';

type FormBodyProps = Omit<
  ContentFormDialogProps,
  'open' | 'onOpenChange' | 'title' | 'description'
> & {
  onCancel: () => void;
};

function FormBody({
  initialValues,
  onSubmit,
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
  error,
  onCancel,
}: FormBodyProps) {
  // Seeded once per open, like the deck form: a parent re-render cannot discard an edit
  // the user has made since the save was refused.
  const [initial] = useState(
    () =>
      initialValues ?? {
        name: '',
        description: '',
        visibility: 'personal' as const,
        groupIds: [],
      },
  );
  const [name, setName] = useState(initial.name);
  const [bankDescription, setBankDescription] = useState(initial.description ?? '');
  const [visibility, setVisibility] = useState(initial.visibility ?? 'personal');
  const [groupIds, setGroupIds] = useState<string[]>(initial.groupIds ?? []);

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit(
      contentFormPayload(initialValues, {
        name: name.trim(),
        description: bankDescription.trim(),
        visibility,
        groupIds,
      }),
    );
  }

  return (
    <>
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button onClick={handleSubmit}>{submitLabel}</Button>
      </DialogFooter>
    </>
  );
}

export function QuestionBankFormDialog({ open, onOpenChange, ...props }: ContentFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <FormBody {...props} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
