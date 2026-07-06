import type { ControllerResponse } from '@/lib/controller-response';
import { requireFeature } from '@/lib/features';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreateGroupSchema,
  GroupIdParamsSchema,
  SetGroupMembersSchema,
  UpdateGroupSchema,
} from '@/server/models/group.model';
import { groupService } from '@/server/services/group.service';

export class GroupController {
  async listGroups(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const groups = await groupService.listGroups(ctx);
      return { success: true, statusCode: 200, data: groups };
    }, ctx);
  }

  async createGroup(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

      const parsed = CreateGroupSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const group = await groupService.createGroup(ctx, parsed.data);
      return { success: true, statusCode: 201, data: group };
    }, ctx);
  }

  async updateGroup(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

      const paramsParsed = GroupIdParamsSchema.safeParse({ id });
      if (!paramsParsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const parsed = UpdateGroupSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const group = await groupService.updateGroup(ctx, paramsParsed.data.id, parsed.data);
      return { success: true, statusCode: 200, data: group };
    }, ctx);
  }

  async deleteGroup(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

      const paramsParsed = GroupIdParamsSchema.safeParse({ id });
      if (!paramsParsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      await groupService.deleteGroup(ctx, paramsParsed.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async getGroupMembers(ctx: RequestContext, groupId: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const paramsParsed = GroupIdParamsSchema.safeParse({ id: groupId });
      if (!paramsParsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const members = await groupService.getGroupMembers(ctx, paramsParsed.data.id);
      return { success: true, statusCode: 200, data: members };
    }, ctx);
  }

  async setGroupMembers(
    ctx: RequestContext,
    groupId: string,
    body: unknown,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'org.manage');

      const paramsParsed = GroupIdParamsSchema.safeParse({ id: groupId });
      if (!paramsParsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const parsed = SetGroupMembersSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await groupService.setGroupMembers(ctx, paramsParsed.data.id, parsed.data);
      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async listMyGroups(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const groups = await groupService.listMyGroups(ctx);
      return { success: true, statusCode: 200, data: groups };
    }, ctx);
  }
}

export const groupController = new GroupController();
