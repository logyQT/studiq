import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// #961: a content write cannot hold `group`. The trigger on
// `org_role_permissions` reads `permissions.allowed_scopes`, so the ban has one
// source of truth and every writer — the role editor, a template copy, a future
// migration, a hand-written statement — meets it.
//
// The positive control is the second test: a trigger that refused every `group`
// scope would make the reader case below fail, so the two together pin the scope
// and not only the refusal.

describe('org_role_permissions content-write scope guard', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let orgId: string;
  let customRoleId: string;

  beforeAll(async () => {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `group-write-${crypto.randomUUID().slice(0, 8)}` })
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

  it('a direct insert of a group content write is refused', async () => {
    for (const key of ['deck.update', 'flashcard.create', 'topic.delete']) {
      const { error } = await service.from('org_role_permissions').insert({
        org_role_id: customRoleId,
        permission_key: key,
        scope: 'group',
      });

      expect(error?.code, `${key} at group`).toBe('22023');
      expect(error?.message, `${key} at group`).toMatch(/not allowed/);
    }
  });

  it('an allowed group read still inserts', async () => {
    const { error } = await service.from('org_role_permissions').insert({
      org_role_id: customRoleId,
      permission_key: 'deck.read',
      scope: 'group',
    });
    expect(error).toBeNull();

    const { data, error: readError } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .eq('org_role_id', customRoleId)
      .eq('permission_key', 'deck.read');
    expect(readError).toBeNull();
    expect(data).toEqual([{ permission_key: 'deck.read', scope: 'group' }]);

    const { error: cleanupError } = await service
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', customRoleId)
      .eq('permission_key', 'deck.read');
    expect(cleanupError).toBeNull();
  });
});
