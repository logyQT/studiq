import { CreateInviteSchema, BulkInviteSchema } from '@/server/models/invitation.model';
import { invitationService } from '@/server/services';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class InvitationController {
  async create(userId: string, body: unknown): Promise<ControllerResponse> {
    try {
      const parsedData = CreateInviteSchema.safeParse(body);

      if (!parsedData.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsedData.error.issues,
        };
      }

      const result = await invitationService.createInvitation(userId, parsedData.data);

      return { success: true, statusCode: 201, data: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getByToken(token: string): Promise<ControllerResponse> {
    try {
      if (!token) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const invitation = await invitationService.getInvitationByToken(token);
      return { success: true, statusCode: 200, data: invitation };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async createBulk(userId: string, body: unknown): Promise<ControllerResponse> {
    try {
      const parsed = BulkInviteSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const results = [];
      for (const invite of parsed.data.invitations) {
        try {
          const result = await invitationService.createInvitation(userId, invite);
          results.push({ success: true, data: result });
        } catch {
          results.push({ success: false, error: 'Failed to create invitation' });
        }
      }

      return { success: true, statusCode: 200, data: { results } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const invitationController = new InvitationController();
