import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type * as React from 'react';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Ui from '@studiq/ui';
import { QuestionBankFormDialog } from '@/components/questions/shared/question-bank-form-dialog';
import { DeckFormDialog } from '@/components/flashcards/shared/deck-form-dialog';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import en from '@/i18n/messages/en.json';

// Dialog content renders through a portal, which a static render skips, so the dialog parts
// become plain wrappers and each form's own markup is what the assertions read.
vi.mock('@studiq/ui', async (importOriginal) => {
  const react = await vi.importActual<typeof React>('react');
  const wrapper = ({ children }: { children?: React.ReactNode }) =>
    react.createElement('div', null, children);
  return {
    ...(await importOriginal<typeof Ui>()),
    Dialog: wrapper,
    DialogContent: wrapper,
    DialogDescription: wrapper,
    DialogFooter: wrapper,
    DialogHeader: wrapper,
    DialogTitle: wrapper,
  };
});

const messages = { ...en, EduFlashcardTopicsPage: { ...en.Common, ...en.EduFlashcardTopicsPage } };
const topicT = createTranslator({ locale: 'en', messages, namespace: 'EduFlashcardTopicsPage' });
const ERROR = 'Failed to save deck You do not have permission to perform this action.';

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages, timeZone: 'UTC' },
      createElement(Fragment, null, node),
    ),
  );
}

const noop = () => {};

function bankDialog(error?: string) {
  return createElement(QuestionBankFormDialog, {
    open: true,
    onOpenChange: noop,
    initialValues: { name: 'Stored bank', description: 'Stored description', visibility: 'group' },
    onSubmit: noop,
    title: 'Edit bank',
    description: 'Edit the bank',
    nameLabel: 'Name',
    namePlaceholder: 'Name',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Description',
    cancelLabel: 'Cancel',
    submitLabel: 'Update',
    error,
  });
}

function deckDialog(error?: string) {
  return createElement(DeckFormDialog, {
    open: true,
    onOpenChange: noop,
    initialValues: { name: 'Stored deck', description: 'Stored description', visibility: 'group' },
    onSubmit: noop,
    title: 'Edit deck',
    description: 'Edit the deck',
    nameLabel: 'Name',
    namePlaceholder: 'Name',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Description',
    cancelLabel: 'Cancel',
    submitLabel: 'Update',
    error,
  });
}

function topicDialog(error?: string) {
  return createElement(TopicFormDialog, {
    open: true,
    onOpenChange: noop,
    editing: { id: 't1', name: 'Stored topic', flashcard_count: 0, created_by: 'u1' },
    formData: { name: 'Stored topic', visibility: 'personal', groupIds: [] },
    onFormDataChange: noop,
    onSubmit: noop,
    onCancel: noop,
    t: topicT,
    error,
  });
}

/**
 * #1560: a refused save must keep the dialog and the edit, and say why in the form. The screens
 * pass the resource's own failure line plus the API's reason; these render checks pin that each
 * dialog shows what it is handed, with the opened values still in the fields.
 */
describe('content dialogs show a refused save in the form (#1560)', () => {
  it.each([
    ['deck', deckDialog, 'Stored deck'],
    ['question bank', bankDialog, 'Stored bank'],
    ['topic', topicDialog, 'Stored topic'],
  ])('shows the reason in the %s dialog, with the opened values intact', (_name, dialog, value) => {
    const markup = render(dialog(ERROR));

    expect(markup).toContain(ERROR);
    expect(markup).toContain(`value="${value}"`);
  });

  it.each([
    ['deck', deckDialog],
    ['question bank', bankDialog],
    ['topic', topicDialog],
  ])('renders no error line in the %s dialog when the last save succeeded', (_name, dialog) => {
    expect(render(dialog())).not.toContain(ERROR);
  });
});
