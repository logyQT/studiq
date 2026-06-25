'use client';

import { useTranslations } from 'next-intl';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { DeckFormDialog } from '@/components/flashcards/shared/deck-form-dialog';

interface DeckDialogsProps {
  t: ReturnType<typeof useTranslations>;
  deckEditOpen: boolean;
  deckDeleteOpen: boolean;
  deckFormData: { name: string; description: string };
  onDeckEditOpenChange: (open: boolean) => void;
  onDeckDeleteOpenChange: (open: boolean) => void;
  onDeckFormDataChange: (data: { name: string; description: string }) => void;
  onDeckUpdate: () => void;
  onDeckDelete: () => void;
}

export function DeckDialogs({
  t,
  deckEditOpen,
  deckDeleteOpen,
  deckFormData,
  onDeckEditOpenChange,
  onDeckDeleteOpenChange,
  onDeckFormDataChange,
  onDeckUpdate,
  onDeckDelete,
}: DeckDialogsProps) {
  return (
    <>
      <DeckFormDialog
        open={deckEditOpen}
        onOpenChange={onDeckEditOpenChange}
        formData={deckFormData}
        onFormDataChange={onDeckFormDataChange}
        onSubmit={onDeckUpdate}
        title={t('deck_edit_title')}
        description={t('deck_edit_desc')}
        nameLabel={t('deck_name_label')}
        namePlaceholder={t('deck_name_placeholder')}
        descriptionLabel={t('deck_description_label')}
        descriptionPlaceholder={t('deck_description_placeholder')}
        cancelLabel={t('common_cancel')}
        submitLabel={t('common_update')}
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
