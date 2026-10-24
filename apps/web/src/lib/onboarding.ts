export interface NeedsOnboardingInput {
  /** Number of organizations the caller is a member of (cached or fresh). */
  orgsCount: number;
  /** React Query `isPending` — no data has resolved for the `['orgs']` query yet. */
  isPending: boolean;
  /** React Query `isFetching` — a request is in flight, possibly a refetch over cached data. */
  isFetching: boolean;
  /** Account type from the JWT (`app_metadata.account_type`). */
  accountType?: string | null;
}

const STAFF_ACCOUNT_TYPES = new Set(['educator', 'manager']);

/**
 * A staff user needs onboarding only when the org list has **settled** and is empty.
 *
 * `isLoading` (`isPending && isFetching` in React Query v5) is not enough: for an
 * already cached entry a background refetch keeps `isLoading` false while the stale
 * data is still rendered, so `needsOnboarding` briefly read `true` on the cached
 * `[]` and `/edu` bounced to `/setup` right after the teacher created a class
 * (#305). Gating on `!isPending && !isFetching` never decides on stale data.
 */
export function resolveNeedsOnboarding({
  orgsCount,
  isPending,
  isFetching,
  accountType,
}: NeedsOnboardingInput): boolean {
  const settled = !isPending && !isFetching;
  return settled && orgsCount === 0 && !!accountType && STAFF_ACCOUNT_TYPES.has(accountType);
}
