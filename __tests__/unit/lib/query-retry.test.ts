import { ApiError } from '@/lib/api';
import { QUERY_MAX_RETRIES, shouldRetryQuery } from '@/lib/query-retry';
import { describe, expect, it } from 'vitest';

// #651 QA: a bad filter (422) or a stale bank URL (404) went through every retry, so the error
// banner took several seconds to appear. A client error is terminal; only transient failures
// are worth asking again.

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409, 422])('does not retry a %i', (status) => {
    expect(shouldRetryQuery(0, new ApiError('CODE', status))).toBe(false);
  });

  it('retries a 5xx up to the max retry count', () => {
    const error = new ApiError('INTERNAL_SERVER', 500);

    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES - 1, error)).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES, error)).toBe(false);
  });

  it('retries a network failure, which has no status', () => {
    const error = new ApiError('NETWORK_ERROR', 0);

    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES, error)).toBe(false);
  });

  it('retries unknown errors until the max retry count', () => {
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES, new Error('boom'))).toBe(false);
  });
});
