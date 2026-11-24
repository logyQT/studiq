import type { PermissionKey, PermissionScope } from '@studiq/authz';
import { apiGet } from '@/lib/api';

/** The `/api/v1/me/permissions` body. */
export interface PermissionsPayload {
  /** The org the map was resolved for; `null` is the personal layer. */
  orgId: string | null;
  /** Every key the resolver answers for; absent or `null` means "not granted". */
  permissions: Partial<Record<PermissionKey, PermissionScope | null>>;
}

export const PERMISSIONS_URL = '/api/v1/me/permissions';

/**
 * Read the active org's scope map.
 *
 * Lives here rather than in the hook so the org switch can fetch the *new* org's
 * map before it navigates without importing the hook module that imports it
 * (`use-orgs.ts` ↔ `use-permissions.ts`).
 */
export function fetchPermissions(): Promise<PermissionsPayload> {
  return apiGet<PermissionsPayload>(PERMISSIONS_URL);
}
