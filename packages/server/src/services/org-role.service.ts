import {
  type CatalogScope,
  type EntitlementProfile,
  isCatalogScope,
  isEntitlementProfile,
  PERMISSIONS,
  type PermissionDefinition,
  type RequestContext,
  ROLE_TEMPLATES,
  type RoleTemplate,
  scopeCovers,
} from '@studiq/authz';
import { log } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbCount, dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import {
  CATALOG_PERMISSION_KEYS,
  type CreateOrgRoleInput,
  isCompleteCatalogPayload,
  type SetRolePermissionsInput,
  type UpdateOrgRoleInput,
} from '@studiq/server/models/org-role.model';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const CATALOG = PERMISSIONS as Record<string, PermissionDefinition | undefined>;

/** `entitlement_profile` is a text column with a CHECK; read it through the catalog type. */
function profileOf(value: string): EntitlementProfile {
  return isEntitlementProfile(value) ? value : 'none';
}

/** The permission rows a template seeds, in catalog order. */
function templateRows(
  orgRoleId: string,
  template: RoleTemplate,
): { org_role_id: string; permission_key: string; scope: CatalogScope }[] {
  return Object.entries(template.permissions).map(([permission_key, scope]) => ({
    org_role_id: orgRoleId,
    permission_key,
    scope,
  }));
}

interface OrgRoleSummary {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  entitlementProfile: EntitlementProfile;
}

type OrgRoleRow = Database['public']['Tables']['org_roles']['Row'];

/**
 * One reading of the role row: `is_system` is nullable (`DEFAULT false`) and
 * `entitlement_profile` is untyped text, so a role without the flag is a custom
 * one and an unreadable profile is the fail-closed `none`.
 */
function toRoleSummary(
  role: Pick<
    OrgRoleRow,
    'id' | 'name' | 'display_name' | 'description' | 'is_system' | 'entitlement_profile'
  >,
): OrgRoleSummary {
  return {
    id: role.id,
    name: role.name,
    displayName: role.display_name,
    description: role.description,
    isSystem: role.is_system ?? false,
    entitlementProfile: profileOf(role.entitlement_profile),
  };
}

export class OrgRoleService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async listRoles(
    ctx: RequestContext,
  ): Promise<ServiceResult<(OrgRoleSummary & { memberCount: number; permissionCount: number })[]>> {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('org_roles')
      .select(
        `
        id, name, display_name, description, is_system, entitlement_profile,
        org_members:org_members(count),
        org_role_permissions:org_role_permissions(count)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .order('name');

    if (error) return toDbFailure(error);

    return success(
      dbRows(data).map((r) => ({
        ...toRoleSummary(r),
        memberCount: dbCount(r.org_members),
        permissionCount: dbCount(r.org_role_permissions),
      })),
    );
  }

  async getRole(
    ctx: RequestContext,
    id: string,
  ): Promise<
    ServiceResult<
      OrgRoleSummary & { permissions: { permissionName: string; scope: CatalogScope }[] }
    >
  > {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('org_roles')
      .select(
        `
        id, name, display_name, description, is_system, entitlement_profile,
        org_role_permissions(permission_key, scope)
      `,
      )
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (error) return toDbFailure(error);

    return success({
      ...toRoleSummary(data),
      permissions: dbRows(data.org_role_permissions).flatMap((p) =>
        isCatalogScope(p.scope) ? [{ permissionName: p.permission_key, scope: p.scope }] : [],
      ),
    });
  }

  async createRole(
    ctx: RequestContext,
    data: CreateOrgRoleInput,
  ): Promise<ServiceResult<OrgRoleSummary>> {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (data.entitlementProfile !== undefined && !isEntitlementProfile(data.entitlementProfile)) {
      return failure('UNPROCESSABLE_ENTITY');
    }

    // D17: a template is an editor preset, materialised as an ordinary custom
    // role. An omitted template means `blank` — a role that holds nothing
    // (fail-closed). The schema owns the closed list; `data.template` is typed.
    const template = ROLE_TEMPLATES[data.template ?? 'blank'];

    const { data: role, error } = await supabase
      .from('org_roles')
      .insert({
        organization_id: ctx.activeOrgId,
        name: data.name,
        display_name: data.name,
        description: data.description ?? null,
        is_system: false,
        // A custom role starts with no paid surface (ADR-0015 §4.2, fail-closed);
        // every preset is `none`, so the template cannot widen it.
        entitlement_profile: data.entitlementProfile ?? template.entitlementProfile,
      })
      .select('id, name, display_name, description, is_system, entitlement_profile')
      .single();

    if (error) return toDbFailure(error);

    const rows = templateRows(role.id, template);
    if (rows.length > 0) {
      const { error: permissionsError } = await supabase.from('org_role_permissions').insert(rows);

      if (permissionsError) {
        // The role and its preset rows are one write: a role whose template
        // failed to apply is a role with less authority than the caller asked
        // for, so undo it rather than leave a half-created row.
        await supabase.from('org_roles').delete().eq('id', role.id);
        return toDbFailure(permissionsError);
      }
    }

    return success(toRoleSummary(role));
  }

  async updateRole(
    ctx: RequestContext,
    id: string,
    data: UpdateOrgRoleInput,
  ): Promise<ServiceResult<OrgRoleSummary>> {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('org_roles')
      .select('is_system')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (fetchError) return toDbFailure(fetchError);

    if (data.name !== undefined && existing.is_system) {
      return failure('FORBIDDEN');
    }

    const update: Database['public']['Tables']['org_roles']['Update'] = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.display_name !== undefined) {
      update.display_name = data.display_name;
    } else if (data.name !== undefined) {
      // `name` is the only label the role dialog edits; `display_name` is the
      // label served to member/invite pickers. Keep them in sync on rename the
      // same way createRole() seeds display_name = name (issue #260).
      update.display_name = data.name;
    }
    if (data.description !== undefined) update.description = data.description;
    if (data.entitlementProfile !== undefined) {
      update.entitlement_profile = data.entitlementProfile;
    }

    // The schema rejects a profile outside the enum; the service is a direct entry
    // point too (tests, scripts), so it checks the catalog as well.
    if (
      update.entitlement_profile !== undefined &&
      !isEntitlementProfile(update.entitlement_profile)
    ) {
      return failure('UNPROCESSABLE_ENTITY');
    }

    if (Object.keys(update).length === 0) {
      return failure('BAD_REQUEST');
    }

    const { data: role, error } = await supabase
      .from('org_roles')
      .update(update)
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, name, display_name, description, is_system, entitlement_profile')
      .single();

    if (error) return toDbFailure(error);

    return success(toRoleSummary(role));
  }

  async deleteRole(ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: role, error: fetchError } = await supabase
      .from('org_roles')
      .select('is_system')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (fetchError) return toDbFailure(fetchError);

    if (role.is_system) {
      return failure('FORBIDDEN');
    }

    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_role_id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (count && count > 0) {
      return failure('CONFLICT');
    }

    const { error } = await supabase
      .from('org_roles')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  /**
   * Replace a role's permission set (ADR-0015 §4.4, §9; D16, D20, D21, D24).
   *
   * The payload is the role's whole catalog set, so the write below cannot strand a
   * permission the editor does not render (D24). It is written target-first — upsert
   * the granted rows, then prune the rest — so a failure can only leave a superset
   * (recoverable on the next save), never an emptied role. Everything the write would
   * change is authorized first: no self-edit unless the caller owns the org, no
   * ownership grant or revoke, and no change to a scope the caller does not hold —
   * removal needs authority over what is removed, addition over what is added.
   */
  async setPermissions(
    ctx: RequestContext,
    id: string,
    data: SetRolePermissionsInput,
  ): Promise<ServiceResult<void>> {
    const supabase = await this.clientFactory();

    // active_org_id is a client-controlled cookie. orgRoleId is only set when
    // with-auth found a real org_members row for this exact org+user, so both
    // checks are required to prove the caller belongs to the active org.
    if (!ctx.activeOrgId || !ctx.orgRoleId) {
      return failure('FORBIDDEN');
    }

    // The schema enforces this at the controller; the service is a direct entry
    // point too (tests, scripts) and the write below relies on the guarantee.
    if (!isCompleteCatalogPayload(data.permissions)) {
      return failure('UNPROCESSABLE_ENTITY');
    }

    // Scope the role to the active org before touching its permissions.
    // A role outside the active org is indistinguishable from a missing role
    // (PGRST116 -> NOT_FOUND, 404) so role ids cannot be probed across tenants.
    const { data: role, error: roleError } = await supabase
      .from('org_roles')
      .select('id, name, org_role_permissions(permission_key, scope)')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (roleError) return toDbFailure(roleError);

    const storedRows = dbRows(role.org_role_permissions);
    const current = new Map<string, CatalogScope>();
    for (const row of storedRows) {
      if (isCatalogScope(row.scope)) current.set(row.permission_key, row.scope);
    }

    const target = new Map<string, CatalogScope | null>();
    for (const key of CATALOG_PERMISSION_KEYS) target.set(key, null);
    for (const entry of data.permissions) target.set(entry.permissionName, entry.scope);
    // A stored row the payload does not mention is a removal, exactly as the
    // write below replaces the whole set.
    for (const key of current.keys()) {
      if (!target.has(key)) target.set(key, null);
    }

    // D21: an org.admin holder may edit their own role — otherwise a single-admin
    // organization could never touch its own Admin role.
    const callerHoldsOwnership = scopeCovers(ctx.permissionScopes['org.admin'], 'organization');

    if (id === ctx.orgRoleId && !callerHoldsOwnership) {
      return failure('FORBIDDEN');
    }

    for (const [key, next] of target) {
      const held = current.get(key) ?? null;
      if (held === next) continue;

      // D16: ownership is not a grant the role editor may hand out or withdraw.
      if (!CATALOG[key]?.assignable) return failure('UNPROCESSABLE_ENTITY');

      if (callerHoldsOwnership) continue;

      const mine = ctx.permissionScopes[key];
      if (held && !scopeCovers(mine, held)) return failure('FORBIDDEN');
      if (next && !scopeCovers(mine, next)) return failure('FORBIDDEN');
    }

    // The gate must survive its own editor: an `org.admin` holder may self-edit, so
    // without this the owner could untick „Role management” on the Admin role and
    // leave no role that holds `org.role.manage` — every write then 403s and
    // `org.admin` is not a fallback (ADR-0015 §4.1). Counted across the org's other
    // roles, before any write, so the answer is the state the save would leave.
    // A legacy row (`scope = 'any'`) is absent from `current` — the editor reads the
    // key as revoked — but it still satisfies `can()` and the RLS predicate, so it
    // counts as a holder here.
    const holdsGate = storedRows.some((row) => row.permission_key === 'org.role.manage');
    if (holdsGate && !target.get('org.role.manage')) {
      const { count, error: gateError } = await supabase
        .from('org_role_permissions')
        .select('org_role_id, org_roles!inner(organization_id)', { count: 'exact', head: true })
        .eq('permission_key', 'org.role.manage')
        .eq('org_roles.organization_id', ctx.activeOrgId)
        .neq('org_role_id', id);

      if (gateError) return toDbFailure(gateError);
      if (!count) return failure('CONFLICT');
    }

    const rows: { org_role_id: string; permission_key: string; scope: CatalogScope }[] = [];
    for (const [permissionKey, scope] of target) {
      if (scope) rows.push({ org_role_id: id, permission_key: permissionKey, scope });
    }

    // Target-first: a failed upsert leaves the previous set untouched and a failed
    // prune leaves a superset the next save prunes. The other order (delete every
    // row, then insert) would empty the role on a write timeout, and the Admin role
    // could not be restored through the editor afterwards (its own `org.admin` row
    // would be gone before the self-edit guard, and nothing else writes permissions).
    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('org_role_permissions')
        .upsert(rows, { onConflict: 'org_role_id,permission_key', ignoreDuplicates: false });

      if (upsertError) return toDbFailure(upsertError);
    }

    const granted = rows.map((row) => row.permission_key);
    let prune = supabase.from('org_role_permissions').delete().eq('org_role_id', id);
    if (granted.length > 0) {
      // PostgREST list syntax; catalog keys are namespaced identifiers, so they
      // carry no quote or comma that would need escaping inside the list.
      prune = prune.not(
        'permission_key',
        'in',
        `(${granted.map((name) => `"${name}"`).join(',')})`,
      );
    }

    const { error: pruneError } = await prune;

    if (pruneError) return toDbFailure(pruneError);

    // D20: no audit table in phase 2 — the change is a log record with the actor,
    // the role and both key→scope maps.
    log('org role permissions changed', {
      'actor.user_id': ctx.userId,
      'org.id': ctx.activeOrgId,
      'role.id': id,
      'role.name': role.name,
      'permissions.before': Object.fromEntries(current),
      'permissions.after': Object.fromEntries(
        rows.map((row) => [row.permission_key, row.scope] as const),
      ),
    });

    return success(undefined);
  }
}
export const orgRoleService = wrapService(new OrgRoleService(createClient), 'org-role.service');
