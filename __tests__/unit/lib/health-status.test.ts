import type { HealthStatusResponse } from '@studiq/server/models/health.model';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { deriveHealthStatusView } from '@/lib/health-status';

const HEALTHY_TIMESTAMP = '2026-01-01T09:00:00.000Z';
const ERROR_TIMESTAMP = Date.parse('2026-01-02T10:30:00.000Z');

function healthBody(
  status: HealthStatusResponse['status'],
  timestamp = HEALTHY_TIMESTAMP,
): HealthStatusResponse {
  return {
    status,
    timestamp,
    uptime: 123,
    environment: 'test',
    services: { supabase: status === 'unhealthy' ? 'down' : 'up' },
    responseTime: 5,
  };
}

/**
 * The public /status page derives its state through this helper, so the
 * error-over-cached-data precedence that #284 review 1 required is pinned here —
 * a background refetch failure must never keep the previous green state on screen.
 */
describe('deriveHealthStatusView (#284)', () => {
  it('is loading on the initial request even when cached data exists', () => {
    expect(
      deriveHealthStatusView({
        isPending: true,
        error: null,
        errorUpdatedAt: 0,
        data: healthBody('healthy'),
      }),
    ).toEqual({ state: 'loading', checkedAt: null });
  });

  it('reports operational for a healthy response', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: null,
      errorUpdatedAt: 0,
      data: healthBody('healthy'),
    });

    expect(view.state).toBe('operational');
    expect(view.checkedAt).toEqual(new Date(HEALTHY_TIMESTAMP));
  });

  it('reports a problem for a degraded response', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: null,
      errorUpdatedAt: 0,
      data: healthBody('degraded'),
    });

    expect(view.state).toBe('problem');
    expect(view.checkedAt).toEqual(new Date(HEALTHY_TIMESTAMP));
  });

  it('reports a problem when the health endpoint answers HTTP 503', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: new ApiError('SERVICE_UNAVAILABLE', 503),
      errorUpdatedAt: ERROR_TIMESTAMP,
      data: undefined,
    });

    expect(view.state).toBe('problem');
    expect(view.checkedAt).toEqual(new Date(ERROR_TIMESTAMP));
  });

  it('reports unavailable for network or aborted requests', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: new Error('Failed to fetch'),
      errorUpdatedAt: ERROR_TIMESTAMP,
      data: undefined,
    });

    expect(view.state).toBe('unavailable');
    expect(view.checkedAt).toEqual(new Date(ERROR_TIMESTAMP));
  });

  it('prefers a failed refetch over the cached healthy data', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: new ApiError('SERVICE_UNAVAILABLE', 503),
      errorUpdatedAt: ERROR_TIMESTAMP,
      data: healthBody('healthy'),
    });

    expect(view.state).toBe('problem');
    expect(view.checkedAt).toEqual(new Date(ERROR_TIMESTAMP));
    expect(view.checkedAt).not.toEqual(new Date(HEALTHY_TIMESTAMP));
  });

  it('prefers a plain refetch error over the cached healthy data', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: new Error('Failed to fetch'),
      errorUpdatedAt: ERROR_TIMESTAMP,
      data: healthBody('healthy'),
    });

    expect(view.state).toBe('unavailable');
    expect(view.checkedAt).toEqual(new Date(ERROR_TIMESTAMP));
  });

  it('reports unavailable when settled without data or error', () => {
    expect(
      deriveHealthStatusView({
        isPending: false,
        error: null,
        errorUpdatedAt: 0,
        data: undefined,
      }),
    ).toEqual({ state: 'unavailable', checkedAt: null });
  });

  it('omits the timestamp when the failure time is unknown', () => {
    const view = deriveHealthStatusView({
      isPending: false,
      error: new Error('Failed to fetch'),
      errorUpdatedAt: 0,
      data: undefined,
    });

    expect(view.checkedAt).toBeNull();
  });
});
