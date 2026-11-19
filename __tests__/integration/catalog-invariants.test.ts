import { FEATURES, PERMISSIONS, Permission } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { LIMITS } from '@studiq/server/services/limit.catalog';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// Catalog invariants for the role-authority programme (ADR-0015 §8.2).
//
// The catalogs exist in three places — TypeScript (`PERMISSIONS`, `FEATURES`,
// `LIMITS`), the migrations and the seeds — and only the database knows whether
// they agree. Every assertion here reads the live catalog:
//
//  - `permissions` is exactly `PERMISSIONS` (key, category, allowed_scopes,
//    assignable). Phase 0b asserted the key set against `Permission`; that is
//    now the subset half, because the catalog is wider than the 26 keys code
//    reads through `ctx.permissionScopes`;
//  - `entitlement_catalog` is exactly the `FEATURES` key set;
//  - `limit_catalog` is exactly `LIMITS`, with the same scope per key;
//  - `permissions` and `FEATURES` stay disjoint namespaces;
//  - every `FEATURES` key still has an `entitlement_flags` row (the 0b
//    assertion, kept until phase 3 makes a missing row fail closed for surface
//    keys only).

describe('catalog invariants', () => {
  let service: SupabaseClient<Database>;
  let permissionRows: Array<{
    key: string;
    category: string;
    allowed_scopes: string[];
    assignable: boolean;
  }>;
  let entitlementKeys: string[];
  let limitRows: Array<{ key: string; scope: string }>;
  let flagKeys: string[];

  beforeAll(async () => {
    service = createServiceClient();

    const { data: permissions, error: permissionsError } = await service
      .from('permissions')
      .select('key, category, allowed_scopes, assignable');
    if (permissionsError) {
      throw new Error(`[catalog] permissions lookup failed: ${permissionsError.message}`);
    }
    permissionRows = dbRows(permissions);

    const { data: entitlements, error: entitlementsError } = await service
      .from('entitlement_catalog')
      .select('key');
    if (entitlementsError) {
      throw new Error(`[catalog] entitlement_catalog lookup failed: ${entitlementsError.message}`);
    }
    entitlementKeys = dbRows(entitlements).map((row) => row.key);

    const { data: limits, error: limitsError } = await service
      .from('limit_catalog')
      .select('key, scope');
    if (limitsError) {
      throw new Error(`[catalog] limit_catalog lookup failed: ${limitsError.message}`);
    }
    limitRows = dbRows(limits);

    const { data: flags, error: flagsError } = await service
      .from('entitlement_flags')
      .select('key');
    if (flagsError) {
      throw new Error(`[catalog] entitlement_flags lookup failed: ${flagsError.message}`);
    }
    flagKeys = dbRows(flags).map((row) => row.key);
  });

  it('no permission is an entitlement key, except the phase-2 management marker', () => {
    const features = new Set<string>(FEATURES);
    const overlap = permissionRows.map((row) => row.key).filter((key) => features.has(key));

    // `group.manage` is a catalog permission (§4.1) and still a legacy
    // entitlement key: phase 2 deletes the four management markers
    // (`org.manage`, `group.manage`, `member.manage`, `role.builder`) from
    // `entitlement_catalog`/`plan_entitlements` once the gates read
    // permissions. Pinning the exact overlap keeps the rest of the namespace
    // split under test until then.
    expect(overlap).toEqual(['group.manage']);
  });

  it('the permissions table is exactly the PERMISSIONS catalog', () => {
    const catalog = new Map(permissionRows.map((row) => [row.key, row]));

    expect(new Set(catalog.keys())).toEqual(new Set(Object.keys(PERMISSIONS)));

    for (const [key, definition] of Object.entries(PERMISSIONS)) {
      const row = catalog.get(key);
      if (!row) throw new Error(`permissions row missing for catalog key ${key}`);

      expect(row.category, key).toBe(definition.category);
      expect([...row.allowed_scopes].toSorted(), key).toEqual(
        [...definition.allowedScopes].toSorted(),
      );
      expect(row.assignable, key).toBe(definition.assignable);
    }
  });

  it('every Permission key is a catalog key', () => {
    const missing = Object.values(Permission).filter((key) => !(key in PERMISSIONS));

    expect(missing).toEqual([]);
  });

  it('the entitlement catalog is exactly the FEATURES key set', () => {
    expect(new Set(entitlementKeys)).toEqual(new Set(FEATURES));
  });

  it('the limit catalog is exactly the LIMITS catalog, key and scope', () => {
    const catalog = new Map(limitRows.map((row) => [row.key, row.scope]));

    expect(new Set(catalog.keys())).toEqual(new Set(Object.keys(LIMITS)));

    for (const [key, definition] of Object.entries(LIMITS)) {
      expect(catalog.get(key), key).toBe(definition.scope);
    }
  });

  it('every feature key has a flag row', () => {
    const flags = new Set(flagKeys);
    const missing = FEATURES.filter((key) => !flags.has(key));

    expect(missing).toEqual([]);
  });
});
