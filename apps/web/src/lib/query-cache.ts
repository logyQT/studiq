import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cached entry is user/org scoped, so an identity change must drop the
 * whole cache: otherwise the anonymous phase's entries (including 401s from
 * `/api/v1/features/me`) stay valid cache hits for the next identity (#458).
 *
 * The first resolution (`undefined` → id|null) must NOT clear — that is a
 * normal page load, not an identity change.
 *
 * @returns `true` when the cache was cleared.
 */
export function resetUserScopedCache(
  queryClient: Pick<QueryClient, 'clear'>,
  previousUserId: string | null | undefined,
  nextUserId: string | null,
): boolean {
  if (previousUserId === undefined || previousUserId === nextUserId) return false;
  queryClient.clear();
  return true;
}
