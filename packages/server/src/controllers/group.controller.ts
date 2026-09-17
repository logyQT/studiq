import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { requireFeature } from '@studiq/server/lib/features';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateGroupSchema,
  GroupIdParamsSchema,
  SetGroupMembersSchema,
  UpdateGroupSchema,
} from '@studiq/server/models/group.model';
import { type GroupService, groupService } from '@studiq/server/services/group.service';

export class GroupController {
  constructor(private groupService: GroupService) {}

  async listGroups(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.groupService.listGroups(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async createGroup(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requireFeature(ctx, 'group.manage');

    const parsed = CreateGroupSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.groupService.createGroup(ctx, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async updateGroup(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    await requireFeature(ctx, 'group.manage');

    const paramsParsed = GroupIdParamsSchema.safeParse({ id });

    if (!paramsParsed.success) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const parsed = UpdateGroupSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.groupService.updateGroup(ctx, paramsParsed.data.id, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async deleteGroup(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    await requireFeature(ctx, 'group.manage');

    const paramsParsed = GroupIdParamsSchema.safeParse({ id });

    if (!paramsParsed.success) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const result = await this.groupService.deleteGroup(ctx, paramsParsed.data.id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async getGroupMembers(ctx: RequestContext, groupId: string): Promise<ControllerResponse> {
    const paramsParsed = GroupIdParamsSchema.safeParse({ id: groupId });

    if (!paramsParsed.success) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const result = await this.groupService.getGroupMembers(ctx, paramsParsed.data.id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async listAddableMembers(ctx: RequestContext, groupId: string): Promise<ControllerResponse> {
    const paramsParsed = GroupIdParamsSchema.safeParse({ id: groupId });

    if (!paramsParsed.success) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const result = await this.groupService.listAddableMembers(ctx, paramsParsed.data.id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async setGroupMembers(
    ctx: RequestContext,
    groupId: string,
    body: unknown,
  ): Promise<ControllerResponse> {
    await requireFeature(ctx, 'group.manage');

    const paramsParsed = GroupIdParamsSchema.safeParse({ id: groupId });

    if (!paramsParsed.success) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const parsed = SetGroupMembersSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.groupService.setGroupMembers(ctx, paramsParsed.data.id, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async listMyGroups(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.groupService.listMyGroups(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
export const groupController = wrapService(new GroupController(groupService), 'group.controller');
