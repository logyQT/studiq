import { rateLimitResponse } from '@studiq/server/lib/rate-limit-response';
import { describe, expect, it } from 'vitest';

describe('rateLimitResponse', () => {
  it('returns the shared 429 body with a Retry-After hint', () => {
    const response = rateLimitResponse({ allowed: false, retryAfterMs: 2_500 });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
  });

  it('omits Retry-After when the limiter has no hint', () => {
    const response = rateLimitResponse({ allowed: false });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeNull();
  });
});
