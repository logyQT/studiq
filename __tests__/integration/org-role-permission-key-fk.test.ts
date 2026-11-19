import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// Phase 2b renames `org_role_permissions.permission_name` to `permission_key` and
// points it at `permissions(key)`. Two things about that are invisible from the
// migration text:
//
//   1. Supabase records a migration as applied from the file name, so a renumbered
//      file whose ledger entry already exists is skipped while every later
//      migration still runs. This schema then has no `permission_key`, and every
//      later `create or replace function` that writes it fails on its first call —
//      which is exactly how a half-applied database fails, long after the reset.
//   2. The scope CHECK accepts only the three scopes the editor can send, so a
//      write that worked before (`any`/`granted`, which nothing resolved) now fails.
//
// Everything else the rename touches — the column name in every reader and writer,
// the backfill's re-created body, the grants — is pinned by the type check, the
// service suites and `grant-parity`.

describe('org_role_permissions.permission_key', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let orgId: string;
  let customRoleId: string;

  beforeAll(async () => {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `permission-key-${crypto.randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);
    orgId = org.id;

    const { data: customRole, error: customError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `custom-${crypto.randomUUID().slice(0, 8)}`,
        display_name: 'Custom',
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    if (customError) throw new Error(`custom role create failed: ${customError.message}`);
    customRoleId = customRole.id;
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('refuses a key the catalog does not know', async () => {
    const { error } = await service.from('org_role_permissions').insert({
      org_role_id: customRoleId,
      permission_key: 'deck.publish',
      scope: 'own',
    });

    // The service maps this to BAD_REQUEST; `org-role.service.test.ts` pins that.
    expect(error?.code).toBe('23503');
  });

  it('refuses a scope outside own | group | organization', async () => {
    for (const scope of ['any', 'granted']) {
      const { error } = await service.from('org_role_permissions').insert({
        org_role_id: customRoleId,
        permission_key: 'topic.read',
        scope,
      });
      expect(error?.code, `${scope} is outside the closed set`).toBe('23514');
    }
  });

  it('round-trips a catalog key at a scope the editor can send', async () => {
    const { error } = await service.from('org_role_permissions').insert({
      org_role_id: customRoleId,
      permission_key: 'deck.read',
      scope: 'group',
    });
    expect(error).toBeNull();

    const { data, error: readError } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .eq('org_role_id', customRoleId);
    expect(readError).toBeNull();
    expect(dbRows(data)).toEqual([{ permission_key: 'deck.read', scope: 'group' }]);
  });
});
