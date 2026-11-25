import {
  type CatalogScope,
  isPermissionCatalogKey,
  PERMISSIONS,
  type PermissionCatalogKey,
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
 * `grantDenied` applies. A non-assignable key (`org.admin`) answers `[]` like
 * the server's `422`, and unknown keys, keys the caller does not hold and an
 * empty map do too.
 *
 * `scopeCovers` and `PERMISSIONS` come from `@studiq/authz` on purpose: the UI
 * and the service must read one rank table (R40), never a copy.
 */
export function grantableScopes(caller: CallerScopeMap, key: string): CatalogScope[] {
  if (!isPermissionCatalogKey(key)) return [];

  const definition = PERMISSIONS[key];
  // Ownership is never assignable, not even to an `org.admin` holder (D16); the
  // service answers 422, so offering the row would only invite that refusal.
  if (!definition.assignable) return [];

  const allowed = definition.allowedScopes;
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

/**
 * The scope the editor starts a new grant at: the narrowest one the caller may
 * grant (ADR-0015 §4.1's narrowest-first rule), falling back to the catalog's
 * first scope only while the authority map is unresolved — the server's own 403
 * then answers. The grant path goes through this, so the default cannot drift
 * from `narrowestGrantable`.
 */
export function startScopeFor(caller: CallerScopeMap, key: PermissionCatalogKey): CatalogScope {
  return narrowestGrantable(caller, key) ?? PERMISSIONS[key].allowedScopes[0];
}

/** What one catalog row offers this caller (ADR-0015 §4.4, D16/D21). */
export interface RowAuthority {
  /** The scopes the caller may grant, or `null` while their map is unresolved. */
  grantable: readonly CatalogScope[] | null;
  /** Ownership is never assignable through the editor (D16). */
  locked: boolean;
  /** A stored grant beyond the caller's authority can be neither moved nor removed. */
  canEditCurrent: boolean;
  /** Whether the grant checkbox can be toggled at all. */
  toggleDisabled: boolean;
}

/**
 * The row's decision, so the editor and its tests read one rule: an unresolved
 * authority map keeps the row offered (the server decides), a key the caller
 * cannot grant is disabled, and a stored grant the caller does not cover stays
 * visible but non-editable — removal is the server's answer, not a hidden key.
 */
export function rowAuthority(
  caller: CallerScopeMap | undefined,
  key: PermissionCatalogKey,
  scope: CatalogScope | null,
): RowAuthority {
  const locked = !PERMISSIONS[key].assignable;
  if (caller === undefined) {
    return { grantable: null, locked, canEditCurrent: true, toggleDisabled: locked };
  }

  const grantable = grantableScopes(caller, key);
  const canEditCurrent = scope === null || grantable.includes(scope);
  const canToggle = scope !== null ? grantable.includes(scope) : grantable.length > 0;
  return { grantable, locked, canEditCurrent, toggleDisabled: locked || !canToggle };
}
