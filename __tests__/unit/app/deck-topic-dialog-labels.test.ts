import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type * as Ui from '@studiq/ui';
import type * as React from 'react';
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TopicDialogs } from '@/components/flashcards/dialogs/topic-dialogs';
import { DeckFormDialog } from '@/components/flashcards/shared/deck-form-dialog';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import en from '@/i18n/messages/en.json';

// Dialog content renders through a portal, which a static render skips. The dialog parts
// become plain wrappers, so every dialog's fields are in the markup; the rest of the UI
// package is real. The browser's own name computation is the e2e spec's job.
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

// `i18n/request.ts` folds `Common` into every namespace, so the app's copy of one is both.
const messages = {
  ...en,
  EduFlashcardTopicsPage: { ...en.Common, ...en.EduFlashcardTopicsPage },
  EduDeckViewPage: { ...en.Common, ...en.EduDeckViewPage },
};
const topicCopy = messages.EduFlashcardTopicsPage;

const noop = () => {};
const groups = [{ id: 'g1', name: 'Group One' }];

interface Tag {
  name: string;
  attributes: Record<string, string>;
  /** Text up to the element's first child or closing tag. */
  text: string;
}

function tags(markup: string): Tag[] {
  return [...markup.matchAll(/<([a-z]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>([^<]*)/g)].map(
    ([, name = '', raw = '', text = '']) => ({
      name,
      attributes: Object.fromEntries(
        [...raw.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map(([, key = '', value = '']) => [
          key,
          value,
        ]),
      ),
      text,
    }),
  );
}

function render(...children: ReactNode[]): Tag[] {
  return tags(
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          NextIntlClientProvider,
          { locale: 'en', messages, timeZone: 'UTC' },
          createElement(Fragment, null, ...children),
        ),
      ),
    ),
  );
}

/** The fields each `<label>` with this text points at, one entry per label. */
function labelled(all: Tag[], label: string): Array<{ id: string; field: string | undefined }> {
  return all
    .filter((tag) => tag.name === 'label' && tag.text === label)
    .map((tag) => {
      const id = tag.attributes.for ?? '';
      return { id, field: all.find((other) => id !== '' && other.attributes.id === id)?.name };
    });
}

/** For each element with this role, the text of the element its `aria-labelledby` names. */
function namedByReference(all: Tag[], role: string): Array<string | undefined> {
  return all
    .filter((tag) => tag.attributes.role === role)
    .map((tag) => {
      const id = tag.attributes['aria-labelledby'];
      return id ? all.find((other) => other.attributes.id === id)?.text : undefined;
    });
}

const ariaLabels = (all: Tag[], match: (tag: Tag) => boolean) =>
  all.filter(match).map((tag) => tag.attributes['aria-label']);
const isCombobox = (tag: Tag) => tag.attributes.role === 'combobox';

const deckForm = (key: string) =>
  createElement(DeckFormDialog, {
    key,
    open: true,
    onOpenChange: noop,
    onSubmit: noop,
    initialValues: { name: '', description: '', visibility: 'group', groupIds: [] },
    title: 'New deck',
    description: 'A new deck',
    nameLabel: 'Deck Name',
    namePlaceholder: 'name placeholder',
    descriptionLabel: 'Deck Description',
    descriptionPlaceholder: 'description placeholder',
    cancelLabel: 'Cancel',
    submitLabel: 'Create',
    groups,
    visibilityLabel: 'Visibility',
    visibilityPersonalLabel: 'Only me',
    visibilityGroupLabel: 'Groups',
    groupsPlaceholder: 'Select groups...',
  });

const topicForm = (key: string) =>
  createElement(TopicFormDialog, {
    key,
    open: true,
    onOpenChange: noop,
    editing: null,
    formData: { name: '', visibility: 'group', groupIds: [] },
    onFormDataChange: noop,
    onSubmit: noop,
    onCancel: noop,
    t: createTranslator({ locale: 'en', messages, namespace: 'EduFlashcardTopicsPage' }),
    groups,
  });

interface FormCase {
  form: string;
  element: (key: string) => ReactElement;
  fields: Array<{ label: string; field: 'input' | 'textarea' }>;
  groupsName: string;
}

const forms: FormCase[] = [
  {
    form: 'deck',
    element: deckForm,
    fields: [
      { label: 'Deck Name', field: 'input' },
      { label: 'Deck Description', field: 'textarea' },
    ],
    groupsName: 'Select groups...',
  },
  {
    form: 'topic',
    element: topicForm,
    fields: [{ label: topicCopy.topic_name_label, field: 'input' }],
    groupsName: topicCopy.groups_placeholder,
  },
];

describe.each(forms)('$form form dialog field names (#680)', ({ element, fields, groupsName }) => {
  it.each(fields)('points the "$label" label at its $field', ({ label, field }) => {
    const matches = labelled(render(element('one')), label);

    expect(matches.map((entry) => entry.field)).toEqual([field]);
    expect(matches[0]?.id).toBeTruthy();
  });

  it('gives two instances their own field ids', () => {
    const all = render(element('one'), element('two'));
    const ids = fields.flatMap(({ label }) => labelled(all, label).map((entry) => entry.id));

    expect(ids).toHaveLength(fields.length * 2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('');
  });

  it('names each visibility radio group by its own visible label', () => {
    const all = render(element('one'), element('two'));
    const references = all
      .filter((tag) => tag.attributes.role === 'radiogroup')
      .map((tag) => tag.attributes['aria-labelledby']);

    expect(namedByReference(all, 'radiogroup')).toEqual(['Visibility', 'Visibility']);
    expect(new Set(references).size).toBe(2);
  });

  it('names the group picker', () => {
    expect(ariaLabels(render(element('one')), isCombobox)).toEqual([groupsName]);
  });
});

describe('deck view topic dialog field names (#680)', () => {
  const page = messages.EduDeckViewPage;
  const all = () =>
    render(
      createElement(TopicDialogs, {
        deckId: 'deck-1',
        t: createTranslator({ locale: 'en', messages, namespace: 'EduDeckViewPage' }),
        topics: [],
        flashcards: [],
        activeFlashcardId: null,
        viewTopicId: null,
        onViewTopicIdChange: noop,
        addTopicOpen: true,
        onAddTopicOpenChange: noop,
        manageTopicOpen: true,
        onManageTopicOpenChange: noop,
      }),
    );

  it('names the add-topic input', () => {
    expect(ariaLabels(all(), (tag) => tag.name === 'input')).toEqual([
      page.add_topic_input_placeholder,
    ]);
  });

  it('names the manage-topics picker', () => {
    expect(ariaLabels(all(), isCombobox)).toEqual([page.manage_topic_title]);
  });
});
