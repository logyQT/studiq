import { readFileSync } from 'node:fs';
import { availableQuestions } from '@/lib/question-browser';
import { describe, expect, it } from 'vitest';

// #651 review: the quiz builder's question picker asks the server to filter by the search term.
// A cache key without the term served a list filtered by one term for another, and a raw term
// in the URL corrupted the query for `&`, `#`, `+` and `%`.
// #651 QA: the picker must not filter the response a second time — it searched the raw input
// while the server searched the trimmed term and treated `*` as a wildcard.

describe('question picker search', () => {
  const source = readFileSync(
    'apps/web/src/app/(frontend)/edu/quizzes/[id]/edit/question-browser.tsx',
    'utf8',
  );

  it('puts the bank and the search term in the shared list key', () => {
    expect(source).toContain('queryKey: questionKeys.list({');
    expect(source).toContain('bankId: selectedBankId');
    expect(source).toContain('search: debouncedSearch || undefined');
    // No hand-written key: it would not be covered by the bank screen's invalidation.
    expect(source).not.toMatch(/queryKey: \['questions'/);
  });

  it('does not draw the empty state while the bank or the term is loading', () => {
    expect(source).toContain('!questionsPending && allQuestions.length === 0');
  });

  it('builds the URL with URLSearchParams, not by string interpolation', () => {
    expect(source).toContain("params.set('search', debouncedSearch)");
    expect(source).not.toMatch(/search=\$\{search\}/);
  });

  it('stops the input at the length the server accepts', () => {
    expect(source).toContain('maxLength={100}');
  });

  it('renders the server result set without a second content filter', () => {
    expect(source).toContain('availableQuestions(questions, existingIds)');
    expect(source).not.toMatch(/content\.toLowerCase\(\)\.includes/);
  });
});

describe('availableQuestions', () => {
  const rows = [
    { id: 'q1', content: 'QA pagination 12 a*b', type: 'open' },
    { id: 'q2', content: 'QA aXb', type: 'open' },
    { id: 'q3', content: 'Cwiczenie QA', type: 'open' },
  ];

  it('offers every row the server returned', () => {
    expect(availableQuestions(rows, new Set()).map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('drops the questions already in the quiz, and only those', () => {
    expect(availableQuestions(rows, new Set(['q2'])).map((q) => q.id)).toEqual(['q1', 'q3']);
  });

  it('keeps rows the raw search term would not have matched', () => {
    // The old client filter compared the raw input, so a leading space or a `*` hid rows the
    // API had matched. The picker no longer passes the term, so both stay visible.
    const typed = ' Cwiczenie';
    const matchesRawInput = rows.filter((q) =>
      q.content.toLowerCase().includes(typed.toLowerCase()),
    );
    expect(matchesRawInput).toEqual([]);
    expect(availableQuestions(rows, new Set())).toHaveLength(3);
  });

  it('has nothing to offer before the first response', () => {
    expect(availableQuestions(undefined, new Set(['q1']))).toEqual([]);
  });
});
