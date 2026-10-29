import { isQuestionListUnavailable } from '@/lib/question-list-state';
import { describe, expect, it } from 'vitest';

// #651 QA: a failed first load drew the empty-bank row ("create your first question!") next to
// the error banner, inviting a read-only viewer to create a question in a bank that never loaded.

describe('isQuestionListUnavailable', () => {
  it('is false while the first page is loading', () => {
    expect(isQuestionListUnavailable({ isError: false, hasPage: false })).toBe(false);
  });

  it('is false when a page loaded', () => {
    expect(isQuestionListUnavailable({ isError: false, hasPage: true })).toBe(false);
  });

  it('is true when the load failed and nothing was ever loaded', () => {
    expect(isQuestionListUnavailable({ isError: true, hasPage: false })).toBe(true);
  });

  it('keeps the stale page when a refetch fails', () => {
    expect(isQuestionListUnavailable({ isError: true, hasPage: true })).toBe(false);
  });
});
