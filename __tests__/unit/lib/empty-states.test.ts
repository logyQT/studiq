import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_VISIT_HINTS, hintStorageKey } from '@/lib/first-visit-hint';

// #666: the list pages show one shared empty state and, on first visit, a dismissible tip.
// A static guard keeps the lists on `EmptyState`, so a new list does not drift back to a bare
// sentence.

const src = (path: string) => readFileSync(join(process.cwd(), 'apps/web/src', path), 'utf8');

/** Pages whose empty list must be rendered by `EmptyState`. */
const LISTS_WITH_EMPTY_STATE = [
  'app/(frontend)/app/assignments/page.tsx',
  'app/(frontend)/edu/assignments/assignments-client.tsx',
  'app/(frontend)/edu/quizzes/quizzes-client.tsx',
  'app/(frontend)/manage/invites/page.tsx',
  'app/(frontend)/manage/members/page.tsx',
  'app/(frontend)/manage/roles/page.tsx',
  'components/groups/group-management-screen.tsx',
  'components/question-reports/reports-list-screen.tsx',
];

/** The screens that show a first-visit tip, and the tip each one shows. */
const HINT_SCREENS: Array<[string, string]> = [
  ['components/flashcards/screens/deck-management-screen.tsx', 'decks'],
  ['components/questions/screens/question-bank-management-screen.tsx', 'question_banks'],
  ['app/(frontend)/edu/assignments/assignments-client.tsx', 'edu_assignments'],
  ['app/(frontend)/app/assignments/page.tsx', 'app_assignments'],
];

describe('lists use the shared EmptyState', () => {
  it.each(LISTS_WITH_EMPTY_STATE)('%s', (file) => {
    const code = src(file);
    expect(code).toContain("from '@/components/shared/empty-state'");
    expect(code).toMatch(/<EmptyState\b/);
  });

  it.each(LISTS_WITH_EMPTY_STATE)('%s has no hand-made empty block left', (file) => {
    // The old pattern: a centred block with an h3 title and a muted sentence.
    expect(src(file)).not.toMatch(/<h3 className="text-lg font-semibold">\{t\('empty'\)\}<\/h3>/);
  });
});

describe('first-visit tips', () => {
  it.each(HINT_SCREENS)('%s shows the "%s" tip', (file, id) => {
    expect(src(file)).toContain(`<FirstVisitHint id="${id}" />`);
  });

  it('every tip id has a screen that shows it', () => {
    expect(HINT_SCREENS.map(([, id]) => id).sort()).toEqual([...FIRST_VISIT_HINTS].sort());
  });

  it('remembers each tip under its own key', () => {
    const keys = FIRST_VISIT_HINTS.map(hintStorageKey);
    expect(new Set(keys).size).toBe(FIRST_VISIT_HINTS.length);
    expect(hintStorageKey('decks')).toBe('studiq:hint:decks');
  });

  it.each(['pl', 'en'])('%s: every tip and the dismiss label have a message', (locale) => {
    const messages = JSON.parse(src(`i18n/messages/${locale}.json`));
    const states = messages.EmptyStates as Record<string, string>;
    expect(states.hint_dismiss).toBeTruthy();
    for (const id of FIRST_VISIT_HINTS) {
      expect(states[`hint_${id}`], `${locale}: EmptyStates.hint_${id}`).toBeTruthy();
    }
  });
});
