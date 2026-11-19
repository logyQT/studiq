import { Permission, type RequestContext } from '@studiq/authz';
import { requirePermission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateOrgRoleSchema,
  OrgRoleIdParamsSchema,
  SetRolePermissionsSchema,
  UpdateOrgRoleSchema,
} from '@studiq/server/models/org-role.model';
import { type OrgRoleService, orgRoleService } from '@studiq/server/services/org-role.service';

/** The 400 every id-addressed route returns for a path id that is not a UUID. */
const INVALID_ROLE_ID: ControllerResponse = {
  success: false,
  statusCode: 400,
  error: 'BAD_REQUEST',
};

function parseRoleId(id: string): string | null {
  const parsed = OrgRoleIdParamsSchema.safeParse({ id });
  return parsed.success ? parsed.data.id : null;
}

export class OrgRoleController {
  constructor(private service: OrgRoleService) {}

  async listRoles(ctx: RequestContext): Promise<ControllerResponse> {
    const roles = await this.service.listRoles(ctx);

    if (isFailure(roles)) {
      return controllerResponse.error(roles.error);
    }

    return controllerResponse.success(roles.data);
  }

  async getRole(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    const roleId = parseRoleId(id);
    if (!roleId) return INVALID_ROLE_ID;

    const role = await this.service.getRole(ctx, roleId);

    if (isFailure(role)) {
      return controllerResponse.error(role.error);
    }

    return controllerResponse.success(role.data);
  }

  async createRole(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_ROLE_MANAGE);

    const parsed = CreateOrgRoleSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const role = await this.service.createRole(ctx, parsed.data);

    if (isFailure(role)) {
      return controllerResponse.error(role.error);
    }

    return controllerResponse.created(role.data);
  }

  async updateRole(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_ROLE_MANAGE);

    const roleId = parseRoleId(id);
    if (!roleId) return INVALID_ROLE_ID;

    const parsed = UpdateOrgRoleSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const role = await this.service.updateRole(ctx, roleId, parsed.data);

    if (isFailure(role)) {
      return controllerResponse.error(role.error);
    }

    return controllerResponse.success(role.data);
  }

  async deleteRole(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_ROLE_MANAGE);

    const roleId = parseRoleId(id);
    if (!roleId) return INVALID_ROLE_ID;

    const result = await this.service.deleteRole(ctx, roleId);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async setPermissions(
    ctx: RequestContext,
    id: string,
    body: unknown,
  ): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_ROLE_MANAGE);

    const roleId = parseRoleId(id);
    if (!roleId) return INVALID_ROLE_ID;

    const parsed = SetRolePermissionsSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.setPermissions(ctx, roleId, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }
}
export const orgRoleController = wrapService(
  new OrgRoleController(orgRoleService),
  'org-role.controller',
);
