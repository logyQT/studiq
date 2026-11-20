import { Permission, type RequestContext } from '@studiq/authz';
import { requireGroupPermission, requirePermission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  AcceptInviteSchema,
  BulkInviteSchema,
  CreateInviteSchema,
  InvitationListQuerySchema,
  UpdateInviteSchema,
} from '@studiq/server/models/invitation.model';
import {
  type InvitationService,
  invitationService,
} from '@studiq/server/services/invitation.service';

export class InvitationController {
  constructor(private service: InvitationService) {}

  /**
   * Create decides the invite's authority from the context alone
   * (ADR-0015 §4.3, §7; D7): a CLASS target (`groupId` + `groupRole`) asks
   * `group.invite` on that group — the group is resolved in the active org
   * first, so a foreign id answers 404, not 403 (§7.1) — while an ORG target
   * asks `org.invitation.manage`. The teacher-name exception is gone: a
   * teacher invites through a class invite, never through an org invite.
   */
  async create(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsedData = CreateInviteSchema.safeParse(body);

    if (!parsedData.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsedData.error.issues);
    }

    const data = parsedData.data;

    if (data.groupId !== undefined) {
      const group = await this.service.resolveInvitableGroup(ctx, data.groupId);
      if (isFailure(group)) return controllerResponse.error(group.error);
      requireGroupPermission(ctx, Permission.GROUP_INVITE, group.data);
    } else {
      await requirePermission(ctx, Permission.ORG_INVITATION_MANAGE);
    }

    const result = await this.service.createInvitation(ctx, data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error, result.details);
    }

    return controllerResponse.created(result.data);
  }

  async getByToken(token: string): Promise<ControllerResponse> {
    if (!token) {
      return controllerResponse.error('BAD_REQUEST');
    }

    const result = await this.service.getInvitationByToken(token);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async accept(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = AcceptInviteSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.acceptInvitation(ctx, parsed.data.token);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async list(ctx: RequestContext, query?: { isAccepted?: boolean }): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_INVITATION_MANAGE);

    const parsed = InvitationListQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.listInvitations(ctx, parsed.data.isAccepted);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async update(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_INVITATION_MANAGE);

    const parsed = UpdateInviteSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.updateInvitation(ctx, id, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async delete(ctx: RequestContext, id: string): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_INVITATION_MANAGE);

    const result = await this.service.deleteInvitation(ctx, id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async createBulk(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    // Bulk is the org-invitation surface: one `org.invitation.manage` check
    // gates the whole batch (entries may not carry a class target — the
    // service refuses them with a 422 naming the entry).
    await requirePermission(ctx, Permission.ORG_INVITATION_MANAGE);

    const parsed = BulkInviteSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    // All-or-nothing: the service validates the whole batch before writing, so
    // a rejected entry is a 4xx for the request instead of a per-item
    // `{ success: false }` inside a 200 (MGR-INV-02).
    const result = await this.service.createInvitationsBulk(ctx, parsed.data.invitations);

    if (isFailure(result)) {
      return controllerResponse.error(result.error, result.details);
    }

    return controllerResponse.success({ results: result.data });
  }
}
export const invitationController = wrapService(
  new InvitationController(invitationService),
  'invitation.controller',
);
