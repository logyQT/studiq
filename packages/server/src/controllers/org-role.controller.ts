import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { requireFeature } from '@studiq/server/lib/features';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateOrgRoleSchema,
  OrgRoleIdParamsSchema,
  SetRolePermissionsSchema,
  UpdateOrgRoleSchema,
} from '@studiq/server/models/org-role.model';
import { type OrgRoleService, orgRoleService } from '@studiq/server/services/org-role.service';

export class OrgRoleController {
  constructor(private orgRoleService: OrgRoleService) {}

  async listRoles(ctx: RequestContext): Promise<ControllerResponse> {
    const roles = await this.orgRoleService.listRoles(ctx);

    if (isFailure(roles)) {
      return controllerResponse.error(roles.error);
    }

    return controllerResponse.success(roles.data);
  }

  async getRole(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    const paramsParsed = OrgRoleIdParamsSchema.safeParse({ id });
    if (!paramsParsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const role = await this.orgRoleService.getRole(ctx, paramsParsed.data.id);

    if (isFailure(role)) {
      return controllerResponse.error(role.error);
    }

    return controllerResponse.success(role.data);
  }

  async createRole(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requireFeature(ctx, 'role.builder');

    const parsed = CreateOrgRoleSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const role = await this.orgRoleService.createRole(ctx, parsed.data);

    if (isFailure(role)) {
      return controllerResponse.error(role.error);
    }

    return controllerResponse.created(role.data);
  }

  async updateRole(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    await requireFeature(ctx, 'role.builder');

    const paramsParsed = OrgRoleIdParamsSchema.safeParse({ id });
    if (!paramsParsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const parsed = UpdateOrgRoleSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const role = await this.orgRoleService.updateRole(ctx, paramsParsed.data.id, parsed.data);

    if (isFailure(role)) {
      return controllerResponse.error(role.error);
    }

    return controllerResponse.success(role.data);
  }

  async deleteRole(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    await requireFeature(ctx, 'role.builder');

    const paramsParsed = OrgRoleIdParamsSchema.safeParse({ id });
    if (!paramsParsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.orgRoleService.deleteRole(ctx, paramsParsed.data.id);

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
    await requireFeature(ctx, 'role.builder');

    const paramsParsed = OrgRoleIdParamsSchema.safeParse({ id });
    if (!paramsParsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const parsed = SetRolePermissionsSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.orgRoleService.setPermissions(ctx, paramsParsed.data.id, parsed.data);

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
