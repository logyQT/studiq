import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { isFailure } from '@/lib/service-result';
import {
  CreatePlanLimitSchema,
  PlanLimitIdParamsSchema,
  UpdatePlanLimitSchema,
} from '@/server/models';
import type { PlanLimitService } from '@/server/services/plan-limit.service';

export class PlanLimitController {
  constructor(private planLimitService: PlanLimitService) {}

  async getAll(planKey?: string): Promise<ControllerResponse> {
    const data = planKey
      ? await this.planLimitService.getByPlanKey(planKey)
      : await this.planLimitService.getAll();

    if (isFailure(data)) {
      return controllerResponse.error(data.error);
    }

    return controllerResponse.success(data.data);
  }

  async create(body: unknown): Promise<ControllerResponse> {
    const parsed = CreatePlanLimitSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const data = await this.planLimitService.create(parsed.data);

    if (isFailure(data)) {
      return controllerResponse.error(data.error);
    }

    return controllerResponse.created(data.data);
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    const parsedId = PlanLimitIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const parsed = UpdatePlanLimitSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const data = await this.planLimitService.update(parsedId.data.id, parsed.data);

    if (isFailure(data)) {
      return controllerResponse.error(data.error);
    }

    return controllerResponse.success(data.data);
  }

  async delete(id: string): Promise<ControllerResponse> {
    const parsed = PlanLimitIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.planLimitService.delete(parsed.data.id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }
}
