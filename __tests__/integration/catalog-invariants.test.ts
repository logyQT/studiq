import { FEATURES, Permission } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// Phase 0b of the role-authority programme (ADR-0015 §8.2 invariants 1 and 8).
// Three properties are cheaper to assert against the live catalog than to
// reason about in review:
//
//  - `permissions` and `FEATURES` are disjoint namespaces. This reads the
//    catalog only; it does not prove that no plan/seat/override write path
//    could still mint a permission key — those guards are phases 2 and 3;
//  - `permissions` is exactly the `Permission` catalog — the N1 guard. A key
//    read from `ctx.permissionScopes` but never seeded denies every caller;
//  - every `FEATURES` key has a flag row, so the resolver cannot fail open on a
//    missing row while phase 0b still has the legacy feature catalog.
//
// The third assertion narrows in phase 1, when `entitlement_catalog.category`
// splits baseline keys (no flag row required) from surface keys.

describe('catalog invariants (phase 0b)', () => {
  let service: SupabaseClient<Database>;
  let permissionNames: string[];
  let flagKeys: string[];

  beforeAll(async () => {
    service = createServiceClient();

    const { data: permissions, error: permissionsError } = await service
      .from('permissions')
      .select('name');
    if (permissionsError) {
      throw new Error(`[catalog] permissions lookup failed: ${permissionsError.message}`);
    }
    permissionNames = dbRows(permissions).map((row) => row.name);

    const { data: flags, error: flagsError } = await service.from('feature_flags').select('key');
    if (flagsError) throw new Error(`[catalog] feature_flags lookup failed: ${flagsError.message}`);
    flagKeys = dbRows(flags).map((row) => row.key);
  });

  it('no permission is an entitlement key', () => {
    const features = new Set<string>(FEATURES);
    const overlap = permissionNames.filter((name) => features.has(name));

    expect(overlap).toEqual([]);
  });

  it('the permissions catalog is exactly the Permission catalog', () => {
    expect(new Set(permissionNames)).toEqual(new Set(Object.values(Permission)));
  });

  it('every feature key has a flag row', () => {
    const flags = new Set(flagKeys);
    const missing = FEATURES.filter((key) => !flags.has(key));

    expect(missing).toEqual([]);
  });
});
