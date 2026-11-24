import type { QueryClient } from '@tanstack/react-query';
import { aiKeys, entitlementKeys, permissionKeys, questionReportKeys } from '@/lib/query-keys';

/**
 * The one place the derived authority caches are dropped (ADR-0015 §7.1, §13
 * batch 7). Every event that can change what the server grants — an org switch,
 * a role save/delete, a seat assignment/release, a checkout or plan change —
 * must go through this, because the two authority payloads, the plan, the AI
 * budget and the report inbox all resolve from the same layers (org plan, role
 * profile, seat, personal plan, overrides, flags) and a partial invalidation
 * leaves one of them telling the caller the previous answer.
 *
 * `refetchPartitioned: false` is for the org switch. `['permissions']` and
 * `['entitlements']` are partitioned by org, and a mutation from one event
 * (role save, seat, checkout) must refetch the active entry immediately. On a
 * switch it must not: at that moment the observed entry is still the *outgoing*
 * org's key while the cookie already names the new org, so a refetch would write
 * the new org's payload under the old org's key and that poisoned entry would
 * read as fresh on the next switch back. Marking the pair stale without a
 * refetch is enough — the key change is what fetches, and a later visit to the
 * old org refetches it because it is stale (ADR-0015 §7.1; design §3.4).
 */
export function invalidateAuthority(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  { refetchPartitioned = true }: { refetchPartitioned?: boolean } = {},
): void {
  const partitionedRefetch = refetchPartitioned ? 'active' : 'none';
  void queryClient.invalidateQueries({
    queryKey: permissionKeys.all,
    refetchType: partitionedRefetch,
  });
  void queryClient.invalidateQueries({
    queryKey: entitlementKeys.all,
    refetchType: partitionedRefetch,
  });
  // Single-entry, org-independent keys: the same entry is overwritten with the
  // new org's answer, so a refetch is always correct (and required).
  void queryClient.invalidateQueries({ queryKey: ['me', 'plan'] });
  void queryClient.invalidateQueries({ queryKey: aiKeys.all });
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
