import { universityMembersService } from '@/server/services';
import { ChangeRoleSchema } from '@/server/models/university-members.model';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class UniversityMembersController {
  async listMembers(userId: string, roleFilter?: string): Promise<ControllerResponse> {
    try {
      const profile = await universityMembersService.getProfile(userId);

      if (!profile.university_id) {
        return { success: false, statusCode: 403, error: 'FORBIDDEN' };
      }

      const members = await universityMembersService.listMembers(profile.university_id, roleFilter);

      return { success: true, statusCode: 200, data: members };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async changeRole(userId: string, body: unknown): Promise<ControllerResponse> {
    try {
      const parsed = ChangeRoleSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await universityMembersService.changeRole(
        userId,
        parsed.data.targetUserId,
        parsed.data.newRole,
      );

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async removeMember(userId: string, targetUserId: string): Promise<ControllerResponse> {
    try {
      if (!targetUserId) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      await universityMembersService.removeMember(userId, targetUserId);

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const universityMembersController = new UniversityMembersController();
