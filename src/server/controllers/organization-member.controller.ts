import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { requireFeature } from '@/lib/features';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { ChangeRoleSchema } from '@/server/models/organization-member.model';
import {
  type OrganizationMemberService,
  organizationMemberService,
} from '@/server/services/organization-member.service';

export class OrganizationMemberController {
  constructor(private organizationMemberService: OrganizationMemberService) {}

  async listMembers(ctx: RequestContext, roleFilter?: string): Promise<ControllerResponse> {
    const members = await this.organizationMemberService.listMembers(ctx, roleFilter);

    if (isFailure(members)) {
      return controllerResponse.error(members.error);
    }

    return controllerResponse.success(members.data);
  }

  async changeRole(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requireFeature(ctx, 'member.manage');

    const parsed = ChangeRoleSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.organizationMemberService.changeRole(
      ctx,
      parsed.data.targetUserId,
      parsed.data.newOrgRoleId,
    );

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async removeMember(ctx: RequestContext, targetUserId: string): Promise<ControllerResponse> {
    await requireFeature(ctx, 'member.manage');

    if (!targetUserId) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.organizationMemberService.removeMember(ctx, targetUserId);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }
}
export const organizationMemberController = wrapService(
  new OrganizationMemberController(organizationMemberService),
  'organization-member.controller',
);
