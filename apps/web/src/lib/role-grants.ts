import {
  type CatalogScope,
  isPermissionCatalogKey,
  PERMISSIONS,
  type PermissionKey,
  type PermissionScope,
  scopeCovers,
} from '@studiq/authz';

/**
 * A caller's authority as `/api/v1/me/permissions` answers it: an absent or
 * `null` entry is a key the caller does not hold.
 */
export type CallerScopeMap = Partial<Record<PermissionKey, PermissionScope | null>>;

/**
 * The scopes of `key` the caller may grant (ADR-0015 §4.4, D16/D21): every
 * allowed scope their own scope covers, or every allowed scope for an
 * `org.admin` holder at organization scope — the same exemption the server's
 * `grantDenied` applies. Unknown keys, keys the caller does not hold and an
 * empty map all answer `[]`.
 *
 * `scopeCovers` and `PERMISSIONS` come from `@studiq/authz` on purpose: the UI
 * and the service must read one rank table (R40), never a copy.
 */
export function grantableScopes(caller: CallerScopeMap, key: string): CatalogScope[] {
  if (!isPermissionCatalogKey(key)) return [];

  const allowed = PERMISSIONS[key].allowedScopes;
  if (scopeCovers(caller['org.admin'], 'organization')) return [...allowed];

  const held = caller[key];
  return allowed.filter((scope) => scopeCovers(held, scope));
}

/**
 * The scope a new grant starts at: the narrowest one the caller may grant
 * (ADR-0015 §4.1's narrowest-first rule), or `null` when they may grant none.
 */
export function narrowestGrantable(caller: CallerScopeMap, key: string): CatalogScope | null {
  return grantableScopes(caller, key)[0] ?? null;
}

/** Whether the caller may grant (or, for a stored grant, remove) `key` at `scope`. */
export function canGrant(caller: CallerScopeMap, key: string, scope: CatalogScope): boolean {
  return grantableScopes(caller, key).includes(scope);
}
