import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import {
  BulkInviteSchema,
  CreateInviteSchema,
  InvitationListQuerySchema,
  UpdateInviteSchema,
} from '@/server/models/invitation.model';
import { type InvitationService, invitationService } from '@/server/services/invitation.service';

export class InvitationController {
  constructor(private invitationService: InvitationService) {}

  async create(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsedData = CreateInviteSchema.safeParse(body);

    if (!parsedData.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsedData.error.issues);
    }

    const result = await this.invitationService.createInvitation(ctx, parsedData.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async getByToken(token: string): Promise<ControllerResponse> {
    if (!token) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const result = await this.invitationService.getInvitationByToken(token);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async accept(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const { token } = body as { token?: string };

    if (!token || typeof token !== 'string') {
      return controllerResponse.error('BAD_REQUEST');
    }

    const result = await this.invitationService.acceptInvitation(ctx, token);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async list(ctx: RequestContext, query?: { isAccepted?: boolean }): Promise<ControllerResponse> {
    const parsed = InvitationListQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.invitationService.listInvitations(ctx, parsed.data.isAccepted);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async update(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    const parsed = UpdateInviteSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.invitationService.updateInvitation(ctx, id, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async delete(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    const result = await this.invitationService.deleteInvitation(ctx, id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async createBulk(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = BulkInviteSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const results = [];

    for (const invite of parsed.data.invitations) {
      const result = await this.invitationService.createInvitation(ctx, invite);

      if (isFailure(result)) {
        results.push({ success: false, error: 'Failed to create invitation' });
      } else {
        results.push({ success: true, data: result.data });
      }
    }

    return controllerResponse.success({ results });
  }
}
export const invitationController = wrapService(
  new InvitationController(invitationService),
  'invitation.controller',
);
