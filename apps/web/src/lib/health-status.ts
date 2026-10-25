import type { HealthStatusResponse } from '@studiq/server/models/health.model';
import { ApiError } from '@/lib/api';

export type HealthStatusState = 'loading' | 'operational' | 'problem' | 'unavailable';

export interface HealthStatusView {
  state: HealthStatusState;
  checkedAt: Date | null;
}

/**
 * Maps a `statusKeys.health` query result to what the public `/status` page
 * renders (#284).
 *
 * `error` takes precedence over `data`, because TanStack Query keeps the previous
 * result when a **refetch** fails (`case 'error'` spreads the old state). Without
 * this order a service that went down while the page was open would keep showing
 * the last green state and its old timestamp on the global
 * `refetchOnWindowFocus: true` path.
 *
 * `unhealthy` is reported as HTTP 503 by `health.controller.ts` (`mapStatusToHttp`),
 * so `apiGet` throws an `ApiError` instead of returning data; that is a real service
 * issue ("problem"), while every other failure (network, 500, non-JSON) means the
 * check itself could not run ("unavailable").
 */
export function deriveHealthStatusView({
  isPending,
  error,
  errorUpdatedAt,
  data,
}: {
  isPending: boolean;
  error: unknown;
  errorUpdatedAt: number;
  data: HealthStatusResponse | undefined;
}): HealthStatusView {
  if (isPending) return { state: 'loading', checkedAt: null };

  if (error) {
    return {
      state: error instanceof ApiError && error.status === 503 ? 'problem' : 'unavailable',
      checkedAt: errorUpdatedAt ? new Date(errorUpdatedAt) : null,
    };
  }

  if (!data) return { state: 'unavailable', checkedAt: null };

  return {
    state: data.status === 'healthy' ? 'operational' : 'problem',
    checkedAt: new Date(data.timestamp),
  };
}
