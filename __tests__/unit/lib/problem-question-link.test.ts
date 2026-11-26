import { QUESTION_SEARCH_MAX_LENGTH } from '@studiq/server/lib/question-search';
import { QuestionListQuerySchema } from '@studiq/server/models/question.model';
import { describe, expect, it } from 'vitest';
import { problemQuestionHref } from '@/lib/problem-question-link';

const searchOf = (content: string) =>
  new URL(problemQuestionHref({ bankId: 'bank-1', content }), 'http://app').searchParams.get(
    'search',
  ) ?? '';

const accepts = (search: string) => QuestionListQuerySchema.safeParse({ search }).success;

describe('problemQuestionHref (#654)', () => {
  it('opens the question’s bank searched for its whole text when it is short', () => {
    expect(problemQuestionHref({ bankId: 'bank-1', content: 'Ile to 2+2?' })).toBe(
      '/edu/questions/bank-1?search=Ile+to+2%2B2%3F',
    );
  });

  it('carries characters that would otherwise end or split the query', () => {
    const content = 'A & B = 100% #1? "tak"\nnie, *może*';

    expect(searchOf(content)).toBe(content);
  });

  it.each([
    ['plain text', 'a'.repeat(250)],
    ['an emoji straddling the limit', `${'a'.repeat(99)}😀 dalej`],
    ['nothing but emoji past the limit', '😀'.repeat(130)],
    ['a space at the limit', `${'a'.repeat(99)} dalej`],
    ['leading and trailing whitespace', `   ${'ż'.repeat(120)}   `],
  ])('cuts %s to a literal start of the text that the bank search accepts', (_label, content) => {
    const search = searchOf(content);

    expect(content.trim().startsWith(search)).toBe(true);
    // A lone surrogate would have come back from the URL as U+FFFD.
    expect(search).not.toContain('�');
    expect(search).toBe(search.trim());
    expect(QuestionListQuerySchema.parse({ search }).search).toBe(search);
  });

  it('keeps exactly as many characters as the limit counts, however wide each one is', () => {
    expect(searchOf('a'.repeat(250))).toBe('a'.repeat(QUESTION_SEARCH_MAX_LENGTH));
    expect(searchOf(`${'a'.repeat(99)}😀tail`)).toBe(`${'a'.repeat(99)}😀`);
    expect(searchOf('😀'.repeat(150))).toBe('😀'.repeat(QUESTION_SEARCH_MAX_LENGTH));
  });

  // Guards the premise above: if the schema ever counted UTF-16 units, the cut would be too long.
  it('has a limit the API counts in code points', () => {
    expect(accepts('😀'.repeat(QUESTION_SEARCH_MAX_LENGTH))).toBe(true);
    expect(accepts('a'.repeat(QUESTION_SEARCH_MAX_LENGTH + 1))).toBe(false);
  });
});
