'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@studiq/ui';
import { useState } from 'react';
import {
  ContentShareSection,
  type SharingFieldsCopy,
  sharingFieldsCopy,
} from '@/components/flashcards/shared/sharing-fields';
import type { ContentFormDialogProps } from '@/components/shared/content-form-dialog-props';
import { ContentFormFooter } from '@/components/shared/content-form-footer';
import { contentFormPayload } from '@/lib/share-fields';

type FormBodyProps = Omit<
  ContentFormDialogProps,
  | 'open'
  | 'onOpenChange'
  | 'title'
  | 'description'
  | 'bodyKey'
  | 'visibilityLabel'
  | 'visibilityPersonalLabel'
  | 'visibilityGroupLabel'
  | 'groupsPlaceholder'
  | 'groupsEmptyText'
  | 'groupsRequiredText'
> & {
  onCancel: () => void;
  shareCopy: SharingFieldsCopy;
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
  shareCopy,
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
  // A group-visible bank must share to at least one group, the same rule the deck and the
  // topic form enforce (#1561). The `groups` guard keeps the form usable without the feature.
  const groupsMissing = !!groups && visibility === 'group' && groupIds.length === 0;
  const share = {
    visibility,
    onVisibilityChange: setVisibility,
    groupIds,
    onGroupIdsChange: setGroupIds,
  };

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
        <ContentShareSection
          idPrefix="qb-visibility"
          value={share}
          groups={groups}
          copy={shareCopy}
          error={error}
        />
      </div>
      <ContentFormFooter
        cancelLabel={cancelLabel}
        submitLabel={submitLabel}
        onCancel={onCancel}
        submitDisabled={groupsMissing}
        onSubmit={handleSubmit}
      />
    </>
  );
}

export function QuestionBankFormDialog({
  open,
  onOpenChange,
  bodyKey,
  ...props
}: ContentFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <FormBody
          key={bodyKey}
          {...props}
          shareCopy={sharingFieldsCopy(props)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
