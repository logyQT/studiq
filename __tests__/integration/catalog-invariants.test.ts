import {
  ENTITLEMENT_KEYS,
  ENTITLEMENTS,
  LIMITS,
  PERMISSIONS,
  Permission,
  SURFACE_ENTITLEMENT_KEYS,
} from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// Catalog invariants for the role-authority programme (ADR-0015 §8.2).
//
// The catalogs exist in two places — TypeScript (`PERMISSIONS`,
// `ENTITLEMENTS`, `LIMITS`) and the migrations — and only the database knows
// whether they agree. Every assertion here reads the live
// catalog:
//
//  - `permissions` is exactly `PERMISSIONS` (key, category, allowed_scopes,
//    assignable). Phase 0b asserted the key set against `Permission`; that is
//    now the subset half, because the catalog is wider than the 26 keys code
//    reads through `ctx.permissionScopes`;
//  - `entitlement_catalog` is exactly `ENTITLEMENTS`, including the metadata a
//    reader gates on (category, scope, seat/personal flags, quota key);
//  - `limit_catalog` is exactly `LIMITS`, with the same scope per key;
//  - `permissions` and `ENTITLEMENTS` stay disjoint namespaces;
//  - every surface entitlement has an `entitlement_flags` row. Baseline keys
//    are always on and may be absent (§8.2 #8); a missing flag row fails closed
//    from phase 3.

describe('catalog invariants', () => {
  let service: SupabaseClient<Database>;
  let permissionRows: Array<{
    key: string;
    category: string;
    allowed_scopes: string[];
    assignable: boolean;
  }>;
  let entitlementRows: Array<{
    key: string;
    category: string;
    scope: string;
    seat_eligible: boolean;
    personal_portable: boolean;
    quota_limit_key: string | null;
  }>;
  let limitRows: Array<{ key: string; scope: string }>;
  let flagKeys: string[];
  let planEntitlementKeys: string[];

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
      .select('key, category, scope, seat_eligible, personal_portable, quota_limit_key');
    if (entitlementsError) {
      throw new Error(`[catalog] entitlement_catalog lookup failed: ${entitlementsError.message}`);
    }
    entitlementRows = dbRows(entitlements);

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

    const { data: planEntitlements, error: planError } = await service
      .from('plan_entitlements')
      .select('entitlement_key');
    if (planError) {
      throw new Error(`[catalog] plan_entitlements lookup failed: ${planError.message}`);
    }
    planEntitlementKeys = dbRows(planEntitlements).map((row) => row.entitlement_key);
  });

  it('no permission is an entitlement key: the namespaces are disjoint', () => {
    const entitlements = new Set<string>(ENTITLEMENT_KEYS);
    const overlap = permissionRows.map((row) => row.key).filter((key) => entitlements.has(key));

    // Phase 1b pinned the exact overlap (`['group.manage']`) while the four
    // legacy management markers were still entitlement keys (R15). Phase 2b-7
    // deleted them — `group.manage` survives only as a permission — so the
    // exception is gone and the namespace split holds without one.
    expect(overlap).toEqual([]);
  });

  it('the four legacy management markers are gone from every entitlement table', () => {
    // The 2b-7 migration deleted `role.builder`, `org.manage`, `member.manage`
    // and `group.manage` from `plan_entitlements`, `entitlement_flags` and
    // `entitlement_catalog`; phase 7 then dropped the legacy per-role table
    // outright. The surviving half of the old overlap is asserted too:
    // `group.manage` is still a permission, in the DB catalog and in
    // `PERMISSIONS`.
    const markers = ['role.builder', 'org.manage', 'member.manage', 'group.manage'];

    const catalogKeys = new Set(entitlementRows.map((row) => row.key));
    const flagSet = new Set(flagKeys);
    expect(markers.filter((key) => catalogKeys.has(key))).toEqual([]);
    expect(markers.filter((key) => flagSet.has(key))).toEqual([]);

    const planKeys = new Set(planEntitlementKeys);
    expect(markers.filter((key) => planKeys.has(key))).toEqual([]);

    const permissionKeys = new Set(permissionRows.map((row) => row.key));
    expect(permissionKeys.has('group.manage')).toBe(true);
    expect('group.manage' in PERMISSIONS).toBe(true);
  });

  it('the legacy org-feature surface is gone, and the profile layer it left is live', async () => {
    // Phase 7 (D19/D27) dropped the revoke store and its four readers. A guard
    // that only asserted absence would pass on an empty schema, so the second
    // half pins the state the deletion leaves: the profile column and a
    // phase-2/5e predicate.
    const raw = process.env.SUPABASE_DB_URL;
    if (!raw) {
      throw new Error(
        'catalog-invariants needs SUPABASE_DB_URL to assert the dropped objects; run the ' +
          'suite through `bun run env:run -- bun run test:integration`.',
      );
    }
    const sql = postgres(raw, { max: 1, onnotice: () => {} });
    try {
      const [dropped] = await sql<
        { table: string | null; has_org_feature: string | null; is_org_manager: string | null }[]
      >`
        select
          to_regclass('public.org_role_features')::text as table,
          to_regprocedure('public.has_org_feature(uuid,uuid,text)')::text as has_org_feature,
          to_regprocedure('public.is_org_manager(uuid,uuid)')::text as is_org_manager
      `;
      expect(dropped).toEqual({
        table: null,
        has_org_feature: null,
        is_org_manager: null,
      });

      const [surviving] = await sql<{ profile: string; check: string; policy: string }[]>`
        select
          (select data_type
             from information_schema.columns
            where table_schema = 'public'
              and table_name = 'org_roles'
              and column_name = 'entitlement_profile') as profile,
          (select conname
             from pg_constraint
            where conrelid = 'public.org_roles'::regclass
              and conname = 'org_roles_entitlement_profile_check') as check,
          (select policyname
             from pg_policies
            where schemaname = 'public'
              and tablename = 'org_roles'
              and policyname = 'Org managers update roles') as policy
      `;
      expect(surviving.profile).toBe('text');
      expect(surviving.check).toBe('org_roles_entitlement_profile_check');
      expect(surviving.policy).toBe('Org managers update roles');
    } finally {
      await sql.end();
    }
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

  it('the entitlement catalog is exactly ENTITLEMENTS, including its metadata', () => {
    const catalog = new Map(entitlementRows.map((row) => [row.key, row]));

    expect(new Set(catalog.keys())).toEqual(new Set(ENTITLEMENT_KEYS));

    for (const [key, definition] of Object.entries(ENTITLEMENTS)) {
      const row = catalog.get(key);
      if (!row) throw new Error(`entitlement_catalog row missing for catalog key ${key}`);

      expect(row.category, key).toBe(definition.category);
      expect(row.scope, key).toBe(definition.scope);
      expect(row.seat_eligible, key).toBe(definition.seatEligible);
      expect(row.personal_portable, key).toBe(definition.personalPortable);
      expect(row.quota_limit_key, key).toBe(definition.quota);
    }
  });

  it('the limit catalog is exactly the LIMITS catalog, key and scope', () => {
    const catalog = new Map(limitRows.map((row) => [row.key, row.scope]));

    expect(new Set(catalog.keys())).toEqual(new Set(Object.keys(LIMITS)));

    for (const [key, definition] of Object.entries(LIMITS)) {
      expect(catalog.get(key), key).toBe(definition.scope);
    }
  });

  it('every surface entitlement has a flag row', () => {
    const flags = new Set(flagKeys);
    const missing = SURFACE_ENTITLEMENT_KEYS.filter((key) => !flags.has(key));

    expect(missing).toEqual([]);
  });
});
