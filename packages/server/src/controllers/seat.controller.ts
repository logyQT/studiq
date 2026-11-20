import { Permission, type RequestContext } from '@studiq/authz';
import { requirePermission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateAssignmentSchema,
  CreatePoolSchema,
  UpdatePoolSchema,
} from '@studiq/server/models/seat.model';
import { type SeatService, seatService } from '@studiq/server/services/seat.service';

/**
 * The `/manage/seats` surface (ADR-0015 §4.1, §7): one capability,
 * `org.seat.manage`, decided from the context alone. It covers the reads the
 * page renders as well as the writes — the seat plan a resolver reads on every
 * feature check is the table, not these routes, so nothing else needs them.
 */
export class SeatController {
  constructor(private service: SeatService) {}

  async listPools(ctx: RequestContext): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_SEAT_MANAGE);

    const result = await this.service.listPools(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async createPool(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_SEAT_MANAGE);

    const parsed = CreatePoolSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.addPool(ctx, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error, result.details);
    return controllerResponse.created(result.data);
  }

  async updatePool(
    ctx: RequestContext,
    poolId: string,
    body: unknown,
  ): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_SEAT_MANAGE);

    const parsed = UpdatePoolSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.updatePool(ctx, poolId, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error, result.details);
    return controllerResponse.success(result.data);
  }

  async listAssignments(ctx: RequestContext): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_SEAT_MANAGE);

    const result = await this.service.listAssignments(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async assignSeat(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_SEAT_MANAGE);

    const parsed = CreateAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.assignSeat(ctx, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async unassignSeat(ctx: RequestContext, assignmentId: string): Promise<ControllerResponse> {
    await requirePermission(ctx, Permission.ORG_SEAT_MANAGE);

    const result = await this.service.unassignSeat(ctx, assignmentId);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(undefined);
  }
}
export const seatController = wrapService(new SeatController(seatService), 'seat.controller');
