import { universityMembersService } from '@/server/services';
import { ChangeRoleSchema } from '@/server/models/university-members.model';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class UniversityMembersController {
  async listMembers(ctx: RequestContext, roleFilter?: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const members = await universityMembersService.listMembers(ctx, roleFilter);

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

      await universityMembersService.changeRole(ctx, parsed.data.targetUserId, parsed.data.newRole);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async removeMember(ctx: RequestContext, targetUserId: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      if (!targetUserId) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      await universityMembersService.removeMember(ctx, targetUserId);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const universityMembersController = new UniversityMembersController();
