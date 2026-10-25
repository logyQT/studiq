import { resolveQuestionBankEmptyView } from '@/lib/question-bank-empty-state';
import { describe, expect, it } from 'vitest';

describe('resolveQuestionBankEmptyView (#360)', () => {
  it('treats a truly empty collection as collection-empty', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'all', groupIds: [] })).toEqual({
      kind: 'collection-empty',
    });
  });

  it('treats a whitespace-only search as no active filter', () => {
    expect(resolveQuestionBankEmptyView({ query: '   ', owner: 'all', groupIds: [] })).toEqual({
      kind: 'collection-empty',
    });
  });

  it('names the trimmed search when it hides every bank', () => {
    expect(resolveQuestionBankEmptyView({ query: '  zzzz  ', owner: 'all', groupIds: [] })).toEqual(
      {
        kind: 'no-results',
        query: 'zzzz',
      },
    );
  });

  it('reports no-results without a query for the ownership filter', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'mine', groupIds: [] })).toEqual({
      kind: 'no-results',
      query: null,
    });
  });

  it('reports no-results without a query for the group filter', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'all', groupIds: ['g-1'] })).toEqual({
      kind: 'no-results',
      query: null,
    });
  });

  it('prefers the search for the copy when several filters are active', () => {
    expect(
      resolveQuestionBankEmptyView({ query: 'hist', owner: 'mine', groupIds: ['g-1'] }),
    ).toEqual({ kind: 'no-results', query: 'hist' });
  });
});
