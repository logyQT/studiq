import { Permission, type RequestContext } from '@studiq/authz';
import { hasPermission, requirePermission } from '@studiq/server/lib/authz';
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
 * The org roster is a write capability (ADR-0015 §4.1, §7): moving a member
 * between roles and removing one ask `org.member.manage`, decided from the
 * context alone.
 *
 * Reading the roster has four authorities (D25). `org.member.manage` is the
 * roster's own key, but it is not the only surface that acts on the roster: a
 * class manager and a class inviter pick from it (`/edu/classroom/members`, the
 * assignment student picker, the `/edu` onboarding counts) and must not hold
 * `org.member.manage` (D18/FP-04), and the Billing preset holds only
 * `org.seat.manage` while `/manage/seats` fills its assign dialog from this
 * endpoint. The catalog has no `org.member.read`. Everyone else reads an empty
 * list rather than a 403, which leaks nothing and is the shape AUT-19 accepts.
 */
function canReadRoster(ctx: RequestContext): boolean {
  // "Holds the key" at any scope is the whole test: a Teacher carries
  // `group.manage`/`group.invite` at `group`, an org role at `organization`.
  return (
    hasPermission(ctx, Permission.ORG_MEMBER_MANAGE) ||
    hasPermission(ctx, Permission.GROUP_MANAGE) ||
    hasPermission(ctx, Permission.GROUP_INVITE) ||
    hasPermission(ctx, Permission.ORG_SEAT_MANAGE)
  );
}

export class OrganizationMemberController {
  constructor(private service: OrganizationMemberService) {}

  async listMembers(ctx: RequestContext, roleFilter?: string): Promise<ControllerResponse> {
    // No active org is not "no rows": the roster is tenant data, so a cookie
    // that names no membership stays a 403 (the service's own contract).
    if (!ctx.activeOrgId) {
      return controllerResponse.error('FORBIDDEN');
    }

    if (!canReadRoster(ctx)) {
      return controllerResponse.success([]);
    }

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
