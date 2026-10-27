import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #651 review: the quiz builder's question picker asks the server to filter by the search term.
// A cache key without the term served a list filtered by one term for another, and a raw term
// in the URL corrupted the query for `&`, `#`, `+` and `%`.

describe('question picker search', () => {
  const source = readFileSync(
    'apps/web/src/app/(frontend)/edu/quizzes/[id]/edit/question-browser.tsx',
    'utf8',
  );

  it('puts the search term in the query key', () => {
    expect(source).toMatch(/queryKey: \['questions', selectedBankId \?\? 'all', debouncedSearch\]/);
  });

  it('builds the URL with URLSearchParams, not by string interpolation', () => {
    expect(source).toContain("params.set('search', debouncedSearch)");
    expect(source).not.toMatch(/search=\$\{search\}/);
  });

  it('stops the input at the length the server accepts', () => {
    expect(source).toContain('maxLength={100}');
  });
});
