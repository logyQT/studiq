import { ApiError } from '@admin/lib/api';
import { QUERY_MAX_RETRIES, shouldRetryQuery } from '@admin/lib/query-retry';
import { describe, expect, it } from 'vitest';

describe('shouldRetryQuery', () => {
  it.each([401, 403, 404, 409])('does not retry a %i', (status) => {
    expect(shouldRetryQuery(0, new ApiError('CODE', status))).toBe(false);
  });

  it('retries a 5xx up to the max retry count', () => {
    const error = new ApiError('INTERNAL_SERVER', 500);

    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES - 1, error)).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES, error)).toBe(false);
  });

  it('retries unknown errors until the max retry count', () => {
    expect(shouldRetryQuery(0, new Error('network'))).toBe(true);
    expect(shouldRetryQuery(QUERY_MAX_RETRIES, new Error('network'))).toBe(false);
  });
});
