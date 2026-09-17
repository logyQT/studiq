import type { RequestContext } from '@studiq/authz';
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

export class SeatController {
  constructor(private seatService: SeatService) {}

  async listPools(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.seatService.listPools(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async createPool(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CreatePoolSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.seatService.addPool(ctx, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async updatePool(
    ctx: RequestContext,
    poolId: string,
    body: unknown,
  ): Promise<ControllerResponse> {
    const parsed = UpdatePoolSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.seatService.updatePool(ctx, poolId, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async listAssignments(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.seatService.listAssignments(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async assignSeat(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CreateAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.seatService.assignSeat(ctx, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async unassignSeat(ctx: RequestContext, assignmentId: string): Promise<ControllerResponse> {
    const result = await this.seatService.unassignSeat(ctx, assignmentId);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(undefined);
  }
}
export const seatController = wrapService(new SeatController(seatService), 'seat.controller');
