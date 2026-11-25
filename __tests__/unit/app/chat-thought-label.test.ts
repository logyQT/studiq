import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '@/components/ai/chat-message';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/** The text of the model's reasoning toggle, as the chat renders it in one language. */
function toggleText(locale: string, messages: typeof pl | typeof en): string {
  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages, timeZone: 'UTC' },
      createElement(ChatMessage, {
        message: {
          id: 'thought-1',
          role: 'thought',
          content: 'reasoning trace',
          status: 'complete',
          thinkingTraces: [],
        },
      }),
    ),
  );
  const button = /<button[^>]*>(.*?)<\/button>/.exec(markup)?.[1] ?? '';
  return button.replace(/<[^>]+>/g, '');
}

describe('the reasoning toggle of a chat message (#1210)', () => {
  it.each([
    ['pl', pl, 'Pokaż myślenie'],
    ['en', en, 'Show thinking'],
  ])('is labelled in %s', (locale, messages, label) => {
    expect(toggleText(locale, messages)).toBe(label);
  });
});
