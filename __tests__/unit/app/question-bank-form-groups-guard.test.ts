import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Ui from '@studiq/ui';
import { QuestionBankFormDialog } from '@/components/questions/shared/question-bank-form-dialog';
import en from '@/i18n/messages/en.json';

// Dialog content renders through a portal, which a static render skips, so the dialog parts
// become plain wrappers and the form's own markup is what the assertions read.
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

const messages = { ...en, QuestionBankManagement: { ...en.Common, ...en.QuestionBankManagement } };
const t = createTranslator({ locale: 'en', messages, namespace: 'QuestionBankManagement' });
const groups = [
  { id: 'g1', name: 'Group One' },
  { id: 'g2', name: 'Group Two' },
];

function renderBankForm(visibility: 'personal' | 'group', groupIds: string[]): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages, timeZone: 'UTC' },
      createElement(QuestionBankFormDialog, {
        open: true,
        onOpenChange: () => {},
        initialValues: { name: 'Bank', description: '', visibility, groupIds },
        onSubmit: () => {},
        title: 'Edit bank',
        description: 'Edit the bank',
        nameLabel: 'Name',
        namePlaceholder: 'Name',
        descriptionLabel: 'Description',
        descriptionPlaceholder: 'Description',
        cancelLabel: 'Cancel',
        submitLabel: 'Update',
        groups,
        groupsRequiredText: t('groups_required'),
      }),
    ),
  );
}

/** The submit button of the rendered footer, as its open tag. */
function submitTag(markup: string): string {
  const tag = /<button[^>]*>Update<\/button>/.exec(markup)?.[0];
  if (!tag) throw new Error('submit button not rendered');
  return tag;
}

/** The `disabled` attribute, not the `disabled:` utility class the button always carries. */
function isDisabled(markup: string): boolean {
  return /\sdisabled(?:="")?(?=[\s>])/.test(submitTag(markup));
}

/**
 * #1561: the bank form, the third of the share dialogs, offered `group` visibility with no group
 * selected. The server answers 422 and the object would claim a share it does not have. The deck
 * and the topic dialogs refuse the state; the bank dialog now does too.
 */
describe('question bank form cannot submit group with no group (#1561)', () => {
  it('disables submit and explains why while group is selected with no group', () => {
    const markup = renderBankForm('group', []);

    expect(isDisabled(markup)).toBe(true);
    expect(markup).toContain(t('groups_required'));
  });

  it('enables submit once a group is selected', () => {
    const markup = renderBankForm('group', ['g1']);

    expect(isDisabled(markup)).toBe(false);
    expect(markup).not.toContain(t('groups_required'));
  });

  it('keeps submit enabled for a personal bank, which needs no group', () => {
    expect(isDisabled(renderBankForm('personal', []))).toBe(false);
  });
});
