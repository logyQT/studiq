import { Permission, type RequestContext } from '@studiq/authz';
import { requirePermission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { ChangeRoleSchema } from '@studiq/server/models/organization-member.model';
import {
  type OrganizationMemberService,
  organizationMemberService,
} from '@studiq/server/services/organization-member.service';

/**
 * The org roster is one capability (ADR-0015 §4.1, §7): reading it, moving a
 * member between roles and removing one all ask `org.member.manage`, decided from
 * the context alone. The old `member.manage` entitlement and the
 * `EDUCATOR|MANAGER` persona are gone from the route.
 */
export class OrganizationMemberController {
  constructor(private service: OrganizationMemberService) {}

  async listMembers(ctx: RequestContext, roleFilter?: string): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_MEMBER_MANAGE);

    const members = await this.service.listMembers(ctx, roleFilter);

    if (isFailure(members)) {
      return controllerResponse.error(members.error);
    }

    return controllerResponse.success(members.data);
  }

  async changeRole(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_MEMBER_MANAGE);

    const parsed = ChangeRoleSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.changeRole(
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
    await requirePermission(ctx, Permission.ORG_MEMBER_MANAGE);

    if (!targetUserId) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.service.removeMember(ctx, targetUserId);

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
