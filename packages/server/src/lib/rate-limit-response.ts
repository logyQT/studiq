import type { RateLimitResult } from '@studiq/server/lib/rate-limiter';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextResponse } from 'next/server';

/**
 * The standard 429 for a per-user burst guard (#662 workstream E). Money
 * actions (checkout/change/cancel) share this so the browser sees the same
 * retry hint as `/billing/reconcile`.
 */
export function rateLimitResponse(limit: RateLimitResult): NextResponse {
  const response = toNextResponse({
    success: false,
    statusCode: 429,
    error: 'RATE_LIMITED',
  });

  if (limit.retryAfterMs !== undefined) {
    response.headers.set('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
  }

  return response;
}
