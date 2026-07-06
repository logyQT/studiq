import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  BulkInviteSchema,
  CreateInviteSchema,
  InvitationListQuerySchema,
  UpdateInviteSchema,
} from '@/server/models/invitation.model';
import { invitationService } from '@/server/services';

export class InvitationController {
  async create(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedData = CreateInviteSchema.safeParse(body);

      if (!parsedData.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsedData.error.issues,
        };
      }

      const result = await invitationService.createInvitation(ctx, parsedData.data);

      return { success: true, statusCode: 201, data: result };
    }, ctx);
  }

  async getByToken(token: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      if (!token) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const invitation = await invitationService.getInvitationByToken(token);
      return { success: true, statusCode: 200, data: invitation };
    });
  }

  async accept(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const { token } = body as { token?: string };
      if (!token || typeof token !== 'string') {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const result = await invitationService.acceptInvitation(ctx, token);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async list(ctx: RequestContext, query?: { isAccepted?: boolean }): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = InvitationListQuerySchema.safeParse(query ?? {});
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const invitations = await invitationService.listInvitations(ctx, parsed.data.isAccepted);
      return { success: true, statusCode: 200, data: invitations };
    }, ctx);
  }

  async update(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateInviteSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await invitationService.updateInvitation(ctx, id, parsed.data);
      return { success: true, statusCode: 200 };
    }, ctx);
  }

  async delete(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await invitationService.deleteInvitation(ctx, id);
      return { success: true, statusCode: 200 };
    }, ctx);
  }

  async createBulk(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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
          const result = await invitationService.createInvitation(ctx, invite);
          results.push({ success: true, data: result });
        } catch {
          results.push({ success: false, error: 'Failed to create invitation' });
        }
      }

      return { success: true, statusCode: 200, data: { results } };
    }, ctx);
  }
}

export const invitationController = new InvitationController();
