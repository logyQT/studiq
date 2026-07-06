import type { ControllerResponse } from '@/lib/controller-response';
import { requireFeature } from '@/lib/features';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreateOrgRoleSchema,
  OrgRoleIdParamsSchema,
  SetRolePermissionsSchema,
  UpdateOrgRoleSchema,
} from '@/server/models/org-role.model';
import { orgRoleService } from '@/server/services/org-role.service';

export class OrgRoleController {
  async listRoles(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const roles = await orgRoleService.listRoles(ctx);
      return { success: true, statusCode: 200, data: roles };
    }, ctx);
  }

  async getRole(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const paramsParsed = OrgRoleIdParamsSchema.safeParse({ id });
      if (!paramsParsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const role = await orgRoleService.getRole(ctx, paramsParsed.data.id);
      return { success: true, statusCode: 200, data: role };
    }, ctx);
  }

  async createRole(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

      const parsed = CreateOrgRoleSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const role = await orgRoleService.createRole(ctx, parsed.data);
      return { success: true, statusCode: 201, data: role };
    }, ctx);
  }

  async updateRole(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

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

      const role = await orgRoleService.updateRole(ctx, paramsParsed.data.id, parsed.data);
      return { success: true, statusCode: 200, data: role };
    }, ctx);
  }

  async deleteRole(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

      const paramsParsed = OrgRoleIdParamsSchema.safeParse({ id });
      if (!paramsParsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      await orgRoleService.deleteRole(ctx, paramsParsed.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async setPermissions(
    ctx: RequestContext,
    id: string,
    body: unknown,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

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

      await orgRoleService.setPermissions(ctx, paramsParsed.data.id, parsed.data);
      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const orgRoleController = new OrgRoleController();
