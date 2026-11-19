import {
  AccountType,
  ROLE_TEMPLATE_NAMES,
  ROLE_TEMPLATES,
  type RoleTemplateName,
  type RequestContext,
} from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, seedOrganization } from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

/**
 * Editor presets against the real table (ADR-0015 §4.2/§9, D17).
 *
 * `ROLE_TEMPLATES` is the source the service copies rows from; this suite proves
 * the copy reaches `org_role_permissions` unchanged, that a preset is an
 * ordinary custom role (not a system one), that `org.admin` is never among the
 * rows, and that the blank preset writes nothing. A preset the constant and the
 * write path disagree about would silently give a new role less authority than
 * the picker promised.
 */

const TEMPLATES = ROLE_TEMPLATE_NAMES;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('OrgRoleService.createRole — presets', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let adminRoleId: string;
  let client: SupabaseClient<Database>;

  function ctx(): RequestContext {
    return {
      traceId: `templates-${tag}`,
      userId: `user-${tag}`,
      accountType: AccountType.MANAGER,
      activeOrgId: orgId,
      orgRoleId: adminRoleId,
      url: '/api/v1/organization/roles',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };
  }

  async function permissionsOf(roleId: string): Promise<Record<string, string>> {
    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .eq('org_role_id', roleId);
    if (error) throw new Error(`permission read failed: ${error.message}`);
    return Object.fromEntries(dbRows(data).map((row) => [row.permission_key, row.scope]));
  }

  async function createFromTemplate(
    name: string,
    template: RoleTemplateName | undefined,
  ): Promise<{ id: string; is_system: boolean | null; entitlement_profile: string }> {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(client));
    const created = await orgRoleService.createRole(ctx(), {
      name,
      ...(template ? { template } : {}),
    });
    if (!created.success) throw new Error(`createRole(${template}) failed: ${created.error}`);

    const { data, error } = await service
      .from('org_roles')
      .select('id, is_system, entitlement_profile')
      .eq('id', created.data.id)
      .single();
    if (error) throw new Error(`role read failed: ${error.message}`);
    return data;
  }

  beforeAll(async () => {
    client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const seeded = await seedOrganization(`templates-${tag}`);
    orgId = seeded.org.id;
    adminRoleId = seeded.adminRoleId;
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
  });

  it('copies every preset matrix exactly as `ROLE_TEMPLATES` declares it', async () => {
    for (const template of TEMPLATES) {
      if (template === 'blank') continue;
      const role = await createFromTemplate(`tpl-${template}-${tag}`, template);

      expect(role.is_system, `${template} is a custom role`).toBe(false);
      expect(role.entitlement_profile, `${template} gets no paid surface`).toBe('none');
      expect(await permissionsOf(role.id), template).toEqual(ROLE_TEMPLATES[template].permissions);
    }
  });

  it('never grants ownership through a preset (D16)', async () => {
    for (const template of TEMPLATES) {
      if (template === 'blank') continue;
      const role = await createFromTemplate(`ownerless-${template}-${tag}`, template);

      expect(await permissionsOf(role.id)).not.toHaveProperty('org.admin');
    }
  });

  it('writes zero permission rows for the blank preset and for an omitted template', async () => {
    for (const [label, template] of [
      ['blank', 'blank'],
      ['omitted', undefined],
    ] as const) {
      const role = await createFromTemplate(`empty-${label}-${tag}`, template);

      expect(role.is_system).toBe(false);
      expect(await permissionsOf(role.id), label).toEqual({});
    }
  });
});
