'use client';

import { useCallback } from 'react';
import { useEntitlements } from '@/hooks/use-entitlements';

/**
 * Entitlement gating for the client. `useEntitlement()` returns a checker for a
 * single entitlement key (e.g. `entitlement('ai.chat')`) backed by the
 * dedicated `/api/v1/me/entitlements` endpoint.
 */
export function useEntitlement() {
  const { data } = useEntitlements();
  // `string` keeps the checker assignable to the nav gates' `(feature: string)`
  // contract; the payload itself is the closed `EntitlementKey` union.
  const enabledEntitlements: readonly string[] | undefined = data?.entitlements;

  return useCallback(
    (entitlement: string) => !!enabledEntitlements?.includes(entitlement),
    [enabledEntitlements],
  );
}
