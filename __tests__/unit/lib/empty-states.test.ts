import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_VISIT_HINTS, hintStorageKey } from '@/lib/first-visit-hint';
import { resolveListEmptyView } from '@/lib/list-empty-view';
import { resolveQuestionBankEmptyView } from '@/lib/question-bank-empty-state';

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
    const keys = FIRST_VISIT_HINTS.map((id) => hintStorageKey(id, 'user-1'));
    expect(new Set(keys).size).toBe(FIRST_VISIT_HINTS.length);
    expect(hintStorageKey('decks', 'user-1')).toBe('studiq:hint:user-1:decks');
  });

  it('remembers a dismissal per user, not per browser', () => {
    expect(hintStorageKey('decks', 'user-1')).not.toBe(hintStorageKey('decks', 'user-2'));
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

// #666 review: a failed request must never be drawn as "nothing here yet, create your first X",
// and a search that matches nothing must not use the collection-empty copy.

/** Lists whose own load can fail; each must branch on the failure before its empty state. */
const LISTS_WITH_ERROR_STATE = [
  'app/(frontend)/app/assignments/page.tsx',
  'app/(frontend)/edu/assignments/assignments-client.tsx',
  'app/(frontend)/edu/quizzes/quizzes-client.tsx',
  'app/(frontend)/manage/invites/page.tsx',
  'app/(frontend)/manage/members/page.tsx',
  'app/(frontend)/manage/roles/page.tsx',
  'components/groups/group-management-screen.tsx',
];

describe('lists report a failed load', () => {
  it.each(LISTS_WITH_ERROR_STATE)('%s renders ErrorState before its empty state', (file) => {
    const code = src(file);
    expect(code).toContain('<ErrorState');
    expect(code.indexOf('<ErrorState')).toBeLessThan(code.indexOf('<EmptyState'));
  });

  it('the decks and topics grids get the failure and a retry through PageGrid', () => {
    for (const file of [
      'components/flashcards/screens/deck-management-screen.tsx',
      'components/flashcards/screens/topic-management-screen.tsx',
    ]) {
      const code = src(file);
      expect(code).toContain('isError={isError}');
      expect(code).toContain('onRetry={() => refetch()}');
      expect(code).toContain('resolveListEmptyView(');
    }
  });

  it('PageGrid has one empty state, the shared one', () => {
    const grid = src('components/shared/page-grid.tsx');
    expect(grid).toContain("from '@/components/shared/empty-state'");
    expect(grid).not.toContain('EmptyDescription');
  });

  it('the shared empty state renders a real heading', () => {
    expect(src('components/shared/empty-state.tsx')).toContain('role="heading" aria-level={3}');
  });

  it('the member and invitation search hand a no-results state instead of "no members"', () => {
    for (const file of [
      'app/(frontend)/manage/members/page.tsx',
      'app/(frontend)/manage/invites/page.tsx',
    ]) {
      expect(src(file)).toContain('<NoResultsState');
    }
  });
});

describe('resolveListEmptyView', () => {
  it('is none while the list has rows', () => {
    expect(resolveListEmptyView({ visibleCount: 3, query: 'x' })).toEqual({ kind: 'none' });
  });

  it('is collection-empty without a search or filter', () => {
    expect(resolveListEmptyView({ visibleCount: 0 })).toEqual({ kind: 'collection-empty' });
    expect(resolveListEmptyView({ visibleCount: 0, query: '   ', activeFilters: 0 })).toEqual({
      kind: 'collection-empty',
    });
  });

  it('is no-results when a search or a filter hid every row', () => {
    expect(resolveListEmptyView({ visibleCount: 0, query: ' algebra ' })).toEqual({
      kind: 'no-results',
      query: 'algebra',
    });
    expect(resolveListEmptyView({ visibleCount: 0, activeFilters: 1 })).toEqual({
      kind: 'no-results',
      query: null,
    });
  });

  it('keeps the question-bank rule of #360 as a thin wrapper', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'all', groupIds: [] })).toEqual({
      kind: 'collection-empty',
    });
    expect(resolveQuestionBankEmptyView({ query: ' x ', owner: 'all', groupIds: [] })).toEqual({
      kind: 'no-results',
      query: 'x',
    });
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'mine', groupIds: [] })).toEqual({
      kind: 'no-results',
      query: null,
    });
  });
});

describe('shared list messages', () => {
  it.each(['pl', 'en'])('%s has the error and no-results copy', (locale) => {
    const states = JSON.parse(src(`i18n/messages/${locale}.json`)).EmptyStates as Record<
      string,
      string
    >;
    for (const key of [
      'load_error',
      'load_error_desc',
      'retry',
      'no_results_query',
      'no_results_filters',
      'clear_filters',
    ]) {
      expect(states[key], key).toBeTruthy();
    }
  });
});
