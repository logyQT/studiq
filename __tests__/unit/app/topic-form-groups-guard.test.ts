import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Ui from '@studiq/ui';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
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

// `i18n/request.ts` folds `Common` into every namespace, so this is the app's copy.
const messages = {
  ...en,
  EduFlashcardTopicsPage: { ...en.Common, ...en.EduFlashcardTopicsPage },
};

const t = createTranslator({ locale: 'en', messages, namespace: 'EduFlashcardTopicsPage' });
const groups = [
  { id: 'g1', name: 'Group One' },
  { id: 'g2', name: 'Group Two' },
];

function renderTopicForm(visibility: 'personal' | 'group', groupIds: string[]): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages, timeZone: 'UTC' },
      createElement(TopicFormDialog, {
        open: true,
        onOpenChange: () => {},
        editing: null,
        formData: { name: 'Topic', visibility, groupIds },
        onFormDataChange: () => {},
        onSubmit: () => {},
        onCancel: () => {},
        t,
        groups,
        groupsRequiredText: t('groups_required'),
      }),
    ),
  );
}

/** The submit button of the rendered footer, as its open tag. */
function submitTag(markup: string): string {
  const tag = /<button[^>]*>Create<\/button>/.exec(markup)?.[0];
  if (!tag) throw new Error('submit button not rendered');
  return tag;
}

/** The `disabled` attribute, not the `disabled:` utility class the button always carries. */
function isDisabled(markup: string): boolean {
  return /\sdisabled(?:="")?(?=[\s>])/.test(submitTag(markup));
}

/**
 * #1561: the topic form offered `group` visibility with no group selected, which the server
 * answers 422 and which leaves a topic whose visibility claims a share it does not have. The
 * deck form refuses the state in the dialog; the topic form now does too.
 */
describe('topic form cannot submit group with no group (#1561)', () => {
  it('disables submit and explains why while group is selected with no group', () => {
    const markup = renderTopicForm('group', []);

    expect(isDisabled(markup)).toBe(true);
    expect(markup).toContain(t('groups_required'));
  });

  it('enables submit once a group is selected', () => {
    const markup = renderTopicForm('group', ['g1']);

    expect(isDisabled(markup)).toBe(false);
    expect(markup).not.toContain(t('groups_required'));
  });

  it('keeps submit enabled for a personal topic, which needs no group', () => {
    const markup = renderTopicForm('personal', []);

    expect(isDisabled(markup)).toBe(false);
  });
});
