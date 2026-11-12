import { ApiError } from '@/lib/api';
import { bankDetailState } from '@/lib/bank-detail-state';
import { describe, expect, it } from 'vitest';

// #1128 — the bank detail screen rendered the authoring empty state for a bank the API rejected
// with 404 (unknown id or another organisation's bank). The query error was never handled, so the
// page looked like an empty bank the educator could fill. Only a 404 is "not found"; a rejected
// request (403/5xx) must stay an error with a retry instead of claiming the bank does not exist.

describe('bankDetailState', () => {
  it('is loading, not not-found, before the first response', () => {
    expect(bankDetailState({ isLoading: true, isError: false, error: null, hasData: false })).toBe(
      'loading',
    );
  });

  it('is not-found for a 404', () => {
    expect(
      bankDetailState({
        isLoading: false,
        isError: true,
        error: new ApiError('NOT_FOUND', 404),
        hasData: false,
      }),
    ).toBe('not-found');
  });

  it('stays an error for a 403 instead of claiming the bank does not exist', () => {
    expect(
      bankDetailState({
        isLoading: false,
        isError: true,
        error: new ApiError('FORBIDDEN', 403),
        hasData: false,
      }),
    ).toBe('error');
  });

  it('stays an error for a 500', () => {
    expect(
      bankDetailState({
        isLoading: false,
        isError: true,
        error: new ApiError('INTERNAL_SERVER', 500),
        hasData: false,
      }),
    ).toBe('error');
  });

  it('stays an error when the request never reached the server', () => {
    expect(
      bankDetailState({
        isLoading: false,
        isError: true,
        error: new ApiError('NETWORK_ERROR', 0),
        hasData: false,
      }),
    ).toBe('error');
  });

  it('is ready once the bank arrives', () => {
    expect(bankDetailState({ isLoading: false, isError: false, error: null, hasData: true })).toBe(
      'ready',
    );
  });

  it('keeps the bank on screen when a refetch fails', () => {
    expect(
      bankDetailState({
        isLoading: false,
        isError: true,
        error: new ApiError('INTERNAL_SERVER', 500),
        hasData: true,
      }),
    ).toBe('ready');
  });
});
