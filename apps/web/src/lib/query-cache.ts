import type { QueryClient } from '@tanstack/react-query';
import { entitlementKeys, permissionKeys, questionReportKeys } from '@/lib/query-keys';

/**
 * The derived authority caches, dropped together: permission scopes,
 * entitlements and the report inbox all resolve from the active org, so an
 * event that changes membership must not refresh one and leave another stale.
 * The partitioned pair is marked stale, never refetched — the key change is
 * what fetches (R45).
 */
export function invalidateAuthority(queryClient: Pick<QueryClient, 'invalidateQueries'>): void {
  void queryClient.invalidateQueries({ queryKey: permissionKeys.all, refetchType: 'none' });
  void queryClient.invalidateQueries({ queryKey: entitlementKeys.all, refetchType: 'none' });
  void queryClient.invalidateQueries({ queryKey: questionReportKeys.all });
}

/**
 * Every cached entry is user/org scoped, so an identity change must drop the
 * whole cache: otherwise the anonymous phase's entries (including 401s from
 * `/api/v1/me/entitlements`) stay valid cache hits for the next identity (#458).
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
