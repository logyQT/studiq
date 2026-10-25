import { resolveQuestionBankEmptyView } from '@/lib/question-bank-empty-state';
import { describe, expect, it } from 'vitest';

describe('resolveQuestionBankEmptyView (#360)', () => {
  it('treats a truly empty collection as collection-empty', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'all', groupFilter: 'all' })).toEqual({
      kind: 'collection-empty',
    });
  });

  it('treats a whitespace-only search as no active filter', () => {
    expect(
      resolveQuestionBankEmptyView({ query: '   ', owner: 'all', groupFilter: 'all' }),
    ).toEqual({
      kind: 'collection-empty',
    });
  });

  it('names the trimmed search when it hides every bank', () => {
    expect(
      resolveQuestionBankEmptyView({ query: '  zzzz  ', owner: 'all', groupFilter: 'all' }),
    ).toEqual({ kind: 'no-results', query: 'zzzz' });
  });

  it('reports no-results without a query for the ownership filter', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'mine', groupFilter: 'all' })).toEqual({
      kind: 'no-results',
      query: null,
    });
  });

  it('reports no-results without a query for the group filter', () => {
    expect(resolveQuestionBankEmptyView({ query: '', owner: 'all', groupFilter: 'mine' })).toEqual({
      kind: 'no-results',
      query: null,
    });
  });

  it('prefers the search for the copy when several filters are active', () => {
    expect(
      resolveQuestionBankEmptyView({ query: 'hist', owner: 'group', groupFilter: 'mine' }),
    ).toEqual({ kind: 'no-results', query: 'hist' });
  });
});
