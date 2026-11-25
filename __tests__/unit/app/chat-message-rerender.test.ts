import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '@/components/ai/chat-message';
import type { ChatMessage as ChatMessageType } from '@/hooks/use-ai-chat';
import pl from '@/i18n/messages/pl.json';

/**
 * #1497: `useAiChat` builds new message objects on each update, with the same ids.
 * `ChatMessage` is a `memo` with its own comparison, so a field that the
 * comparison does not read can change while the screen stays the same.
 *
 * The suite has no DOM, so this test applies the rule of `React.memo` itself: React
 * compares the previous props with the next props. When the comparison says
 * "equal", the screen keeps the last render, and the next props become the
 * previous props. The comparison and the component are the real ones.
 */
interface Props {
  message: ChatMessageType;
  onAnswer: (text: string) => void;
}

type Compare = (previous: Props, next: Props) => boolean;

const isCompare = (value: unknown): value is Compare => typeof value === 'function';

const compareField: unknown = Reflect.get(ChatMessage, 'compare');

/** The same function each time, as the chat screen passes a stable callback. */
const onAnswer = () => {};

function draw(props: Props): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'pl', messages: pl, timeZone: 'UTC' },
      createElement(ChatMessage, props),
    ),
  );
}

/** One mounted `ChatMessage`: `update` returns what the screen shows afterwards. */
function mount(first: ChatMessageType) {
  if (!isCompare(compareField)) throw new Error('ChatMessage has no memo comparison');
  const compare = compareField;
  let previous: Props = { message: first, onAnswer };
  let screen = draw(previous);

  return {
    screen: () => screen,
    update(message: ChatMessageType): string {
      const next: Props = { message, onAnswer };
      if (!compare(previous, next)) screen = draw(next);
      previous = next;
      return screen;
    },
  };
}

const STEPS = ['fetch_material', 'extract_concepts', 'generate_flashcards'].map(
  (action, index) => ({
    index,
    action,
    rationale: `reason ${index}`,
  }),
);

/** The plan message as the hook builds it: a new object with the same id each time. */
function plan(completedSteps: number[], planCompleted = false): ChatMessageType {
  return {
    id: 'm1-plan-0',
    role: 'plan',
    content: '',
    status: 'complete',
    thinkingTraces: [],
    plan: STEPS.map((step) => ({ ...step })),
    completedSteps: [...completedSteps],
    planCompleted,
  };
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ');
const count = (markup: string, className: string) => markup.split(className).length - 1;
/** The icon of a completed step, and the spinner of the step in progress. */
const icons = (markup: string) => ({
  done: count(markup, 'lucide-sparkles'),
  inProgress: count(markup, 'animate-spin'),
});

describe('ChatMessage after an update of the same message (#1497)', () => {
  it('moves the plan counter and the step icons as steps complete', () => {
    const message = mount(plan([]));
    expect(text(message.screen())).toContain('0 / 3 completed');
    expect(icons(message.screen())).toEqual({ done: 0, inProgress: 1 });

    for (const [completed, done] of [
      [[0], 1],
      [[0, 1], 2],
    ] as const) {
      const screen = message.update(plan([...completed]));

      expect(text(screen)).toContain(`${done} / 3 completed`);
      expect(icons(screen)).toEqual({ done, inProgress: 1 });
    }

    const last = message.update(plan([0, 1, 2], true));
    expect(text(last)).toContain('All steps complete');
    expect(icons(last)).toEqual({ done: 3, inProgress: 0 });
  });

  it('shows "All steps complete" when only planCompleted changes', () => {
    const message = mount(plan([0, 1, 2]));
    expect(text(message.screen())).toContain('3 / 3 completed');

    expect(text(message.update(plan([0, 1, 2], true)))).toContain('All steps complete');
  });

  it('moves the icon when another step is the completed one', () => {
    const message = mount(plan([0]));
    const before = message.screen();

    const after = message.update(plan([1]));

    expect(after).not.toBe(before);
    expect(after).toBe(draw({ message: plan([1]), onAnswer }));
  });

  it('shows a question that arrives on a message that is on the screen', () => {
    const answer: ChatMessageType = {
      id: 'm1-text-0',
      role: 'assistant',
      content: 'Mam jedno pytanie.',
      status: 'complete',
      thinkingTraces: [],
    };
    const message = mount(answer);

    const screen = message.update({
      ...answer,
      question: { id: 'q1', question: 'Który poziom wybierasz?' },
    });

    expect(text(screen)).toContain('Który poziom wybierasz?');
  });
});
