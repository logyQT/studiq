'use client';

import type { useTranslations } from 'next-intl';
import { DeckFormDialog } from '@/components/flashcards/shared/deck-form-dialog';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';

interface GroupOption {
  id: string;
  name: string;
}

interface DeckDialogsProps {
  t: ReturnType<typeof useTranslations>;
  deckEditOpen: boolean;
  deckDeleteOpen: boolean;
  onDeckEditOpenChange: (open: boolean) => void;
  onDeckDeleteOpenChange: (open: boolean) => void;
  onDeckUpdate: (data: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }) => void;
  onDeckDelete: () => void;
  initialValues?: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  } | null;
  groups?: GroupOption[];
}

export function DeckDialogs({
  t,
  deckEditOpen,
  deckDeleteOpen,
  onDeckEditOpenChange,
  onDeckDeleteOpenChange,
  onDeckUpdate,
  onDeckDelete,
  initialValues,
  groups,
}: DeckDialogsProps) {
  return (
    <>
      <DeckFormDialog
        open={deckEditOpen}
        onOpenChange={onDeckEditOpenChange}
        onSubmit={onDeckUpdate}
        title={t('deck_edit_title')}
        description={t('deck_edit_desc')}
        nameLabel={t('deck_name_label')}
        namePlaceholder={t('deck_name_placeholder')}
        descriptionLabel={t('deck_description_label')}
        descriptionPlaceholder={t('deck_description_placeholder')}
        cancelLabel={t('common_cancel')}
        submitLabel={t('common_update')}
        initialValues={initialValues}
        groups={groups}
        visibilityLabel={t('visibility_label')}
        visibilityPersonalLabel={t('visibility_personal')}
        visibilityGroupLabel={t('visibility_group')}
        groupsPlaceholder={t('groups_placeholder')}
        groupsEmptyText={t('groups_empty')}
      />

      <DeleteConfirmDialog
        open={deckDeleteOpen}
        onOpenChange={onDeckDeleteOpenChange}
        onConfirm={onDeckDelete}
        title={t('deck_delete_title')}
        description={t('deck_delete_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />
    </>
  );
}
