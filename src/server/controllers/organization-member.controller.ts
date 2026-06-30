import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { ChangeRoleSchema } from '@/server/models/organization-member.model';
import { organizationMemberService } from '@/server/services';

export class OrganizationMemberController {
  async listMembers(ctx: RequestContext, roleFilter?: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const members = await organizationMemberService.listMembers(ctx, roleFilter);

      return { success: true, statusCode: 200, data: members };
    }, ctx);
  }

  async changeRole(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = ChangeRoleSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await organizationMemberService.changeRole(
        ctx,
        parsed.data.targetUserId,
        parsed.data.newRole,
      );

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async removeMember(ctx: RequestContext, targetUserId: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      if (!targetUserId) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      await organizationMemberService.removeMember(ctx, targetUserId);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const organizationMemberController = new OrganizationMemberController();
